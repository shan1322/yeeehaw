import wikipediaapi
import requests
import json
from app.config import settings
import re
from urllib.parse import urlparse, unquote

def extract_title_from_url(url: str) -> str | None:
    """
    Basic function to extract Wikipedia page title from a URL.
    Handles common formats like /wiki/Page_Title.
    Returns None if extraction fails.
    """
    try:
        parsed_url = urlparse(url)
        if "wikipedia.org" in parsed_url.netloc:
            # Path is usually like /wiki/Page_Title or /en/wiki/Page_Title
            path_parts = [part for part in parsed_url.path.split('/') if part]
            if 'wiki' in path_parts:
                title_index = path_parts.index('wiki') + 1
                if title_index < len(path_parts):
                    # Decode URL encoding (e.g., %20 -> space) and replace underscores
                    raw_title = unquote(path_parts[title_index])
                    title = raw_title.replace('_', ' ')
                    return title
    except Exception as e:
        print(f"Error parsing Wikipedia URL '{url}': {str(e)}")
    return None

def search_wikipedia(query, max_results=settings.MAX_WIKI_RESULTS):
    """
    Search Wikipedia for relevant pages based on the query
    """
    try:
        # Use Wikipedia API to search for pages
        search_url = f"https://en.wikipedia.org/w/api.php"
        search_params = {
            "action": "query",
            "format": "json",
            "list": "search",
            "srsearch": query,
            "srlimit": max_results
        }

        response = requests.get(search_url, params=search_params)
        response.raise_for_status() # Raise an exception for bad status codes
        data = response.json()

        if "query" in data and "search" in data["query"]:
            # Return list of page titles
            return [result["title"] for result in data["query"]["search"]]
        return []
    except requests.exceptions.RequestException as e:
        print(f"Network error searching Wikipedia: {str(e)}")
        return []
    except json.JSONDecodeError as e:
        print(f"Error decoding Wikipedia search response: {str(e)}")
        return []
    except Exception as e:
        print(f"Error searching Wikipedia: {str(e)}")
        return []

def get_wiki_content(page_titles):
    """
    Extract content from Wikipedia pages identified by titles.
    Returns: (context_text, sources)
    """
    # Initialize Wikipedia API object (ensure user agent is set)
    try:
        headers = {'User-Agent': 'WikiGPT/1.0 (yourname@example.com)'} # Replace with your info
        wiki_wiki = wikipediaapi.Wikipedia(
            language='en',
            extract_format=wikipediaapi.ExtractFormat.WIKI,
            user_agent=headers['User-Agent'] # Pass user agent here if supported or set globally
        )
    except Exception as e:
        print(f"Error initializing Wikipedia API: {str(e)}")
        return "Error initializing Wikipedia API.", []

    context_parts = []
    sources = []
    titles_processed = set() # Keep track of processed titles to avoid duplicates

    # Limit the number of pages to process to avoid excessive requests
    pages_to_process = page_titles[:settings.MAX_WIKI_RESULTS] # Use configured limit

    for title in pages_to_process:
        if title in titles_processed:
            continue # Skip duplicate titles

        try:
            page = wiki_wiki.page(title)
            if page.exists():
                titles_processed.add(title) # Mark as processed
                # Get summary and first part of content
                # Note: page.summary might be empty if page is disambiguation/redirect etc.
                # Use page.text for more robust content extraction
                content = page.text # Use page.text which often includes summary + intro

                if not content: # Fallback if text is empty
                    content = page.summary

                # Truncate content if it exceeds the max length
                if len(content) > settings.WIKI_CONTENT_MAX_LENGTH:
                    content = content[:settings.WIKI_CONTENT_MAX_LENGTH] + "..."
                elif not content:
                     content = f"No text content could be extracted for '{title}'."


                context_parts.append(f"--- Wikipedia article: {title} ---\n{content}")

                # Add source
                sources.append({
                    "title": title,
                    "url": page.fullurl
                })
        except requests.exceptions.RequestException as e:
             print(f"Network error fetching content for {title}: {str(e)}")
             # Optionally add a note to context that this page failed
             context_parts.append(f"--- Note: Could not fetch content for Wikipedia article: {title} due to network error ---")
        except Exception as e:
            print(f"Error fetching Wikipedia content for {title}: {str(e)}")
            context_parts.append(f"--- Note: Error fetching content for Wikipedia article: {title} ---")


    if not context_parts:
        return "Could not retrieve content from the specified Wikipedia page(s).", []

    full_context = "\n\n".join(context_parts)
    return full_context, sources


def query_mistral(messages, context):
    """
    Query Mistral AI with conversation history and Wikipedia context
    """
    api_key = settings.MISTRAL_API_KEY
    if not api_key:
        return "Error: Mistral API key not configured. Please set the MISTRAL_API_KEY environment variable."

    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": f"Bearer {api_key}"
    }

    # Add system message with Wikipedia context
    formatted_messages = [
        {
            "role": "system",
            "content": (
                "You are WikiGPT, a helpful assistant that answers questions based on Wikipedia information. "
                "Use the following Wikipedia content to answer the user's question. "
                "If the Wikipedia content doesn't contain the answer, say so and answer based on your knowledge, "
                "but make it clear what information comes from Wikipedia and what doesn't. "
                "Format your response clearly, with proper paragraphs, without using markdown syntax like asterisks for emphasis. "
                f"Here's the Wikipedia content to help answer the most recent question:\n\n{context}"
            )
        }
    ]

    # Add user messages (ensure roles are user/assistant)
    valid_roles = {"user", "assistant"}
    formatted_messages.extend([msg for msg in messages if msg.get("role") in valid_roles])


    # Prepare the request payload
    payload = {
        "model": settings.MISTRAL_MODEL,
        "messages": formatted_messages,
        "max_tokens": settings.MISTRAL_MAX_TOKENS,
        "temperature": settings.MISTRAL_TEMPERATURE
    }

    try:
        response = requests.post(
            "https://api.mistral.ai/v1/chat/completions",
            headers=headers,
            json=payload,
            timeout=60 # Add a timeout
        )

        response.raise_for_status() # Raise HTTPError for bad responses (4xx or 5xx)

        result = response.json()
        if result.get("choices") and result["choices"][0].get("message"):
             content = result["choices"][0]["message"].get("content", "No content in response")

             # Basic HTML escaping/formatting replacement if needed
             content = re.sub(r'\*\*(.*?)\*\*', r'<strong>\1</strong>', content)
             content = re.sub(r'\*(.*?)\*', r'<em>\1</em>', content)

             return content
        else:
            print(f"Unexpected response structure from Mistral API: {result}")
            return "Error: Received unexpected response structure from AI."

    except requests.exceptions.Timeout:
        print("Error: Request to Mistral API timed out.")
        return "Error: The request to the AI timed out."
    except requests.exceptions.RequestException as e:
        print(f"Error from Mistral API: {e.response.status_code if e.response else 'N/A'} - {e.response.text if e.response else str(e)}")
        status_code = e.response.status_code if e.response is not None else 'N/A'
        return f"Error getting response from Mistral API: Status {status_code}"
    except Exception as e:
        print(f"Exception when calling Mistral API: {str(e)}")
        return f"Error communicating with Mistral API: {str(e)}"