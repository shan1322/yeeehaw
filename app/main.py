from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import os
import re
import json
import uvicorn
import logging
# Ensure config is imported correctly relative to main.py location
try:
    from app.config import settings
    from utils.wiki_utils import search_wikipedia, get_wiki_content, query_mistral, extract_title_from_url
except ImportError:
    # Handle cases where script is run from a different directory
    import sys
    sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from app.config import settings
    from utils.wiki_utils import search_wikipedia, get_wiki_content, query_mistral, extract_title_from_url


# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="WikiGPT")

# Determine static and templates directory relative to this file
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(os.path.dirname(BASE_DIR), "static")
TEMPLATES_DIR = os.path.join(os.path.dirname(BASE_DIR), "templates")


# Mount static files with the correct path
if os.path.isdir(STATIC_DIR):
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
    logger.info(f"Mounted static directory: {STATIC_DIR}")
else:
    logger.error(f"Static directory not found: {STATIC_DIR}")

# Setup templates with the correct path
if os.path.isdir(TEMPLATES_DIR):
    templates = Jinja2Templates(directory=TEMPLATES_DIR)
    logger.info(f"Located templates directory: {TEMPLATES_DIR}")
else:
     logger.error(f"Templates directory not found: {TEMPLATES_DIR}")
     templates = None # Handle case where templates aren't found


class ChatMessage(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    messages: List[ChatMessage]
    search_query: Optional[str] = None
    wiki_url: Optional[str] = None # New field for URL
    wiki_mode: str = "search" # New field for mode ('search', 'url_only', 'both')

@app.get("/", response_class=HTMLResponse)
async def root(request: Request):
    logger.info("Loading root page")
    if templates:
        return templates.TemplateResponse("index.html", {"request": request})
    else:
        return HTMLResponse("<html><body><h1>Error: Templates not found.</h1></body></html>")


@app.post("/chat")
async def chat(chat_request: ChatRequest):
    """
    Process chat messages, optionally use provided URL, search Wikipedia,
    and return AI response based on selected mode.
    """
    try:
        logger.info(f"Received chat request: Mode='{chat_request.wiki_mode}', URL='{chat_request.wiki_url}', Messages#={len(chat_request.messages)}")

        # Extract the last user message as the main query if search_query not provided
        user_message = ""
        for msg in reversed(chat_request.messages):
            if msg.role == "user":
                user_message = msg.content
                break

        search_query = chat_request.search_query or user_message
        logger.info(f"Effective search query: {search_query}")

        if not search_query and not chat_request.wiki_url:
             logger.warning("No search query or URL provided.")
             # Return an informative message or default response
             return {"response": "Please provide a question or a Wikipedia URL.", "sources": []}


        wiki_page_titles = []
        url_page_title = None
        context = "No Wikipedia context was generated." # Default context
        sources = [] # Initialize sources list

        # 1. Extract title from URL if provided
        if chat_request.wiki_url:
            url_page_title = extract_title_from_url(chat_request.wiki_url)
            if url_page_title:
                logger.info(f"Extracted title from URL: '{url_page_title}'")
            else:
                logger.warning(f"Could not extract title from URL: {chat_request.wiki_url}")
                # Optionally inform the user in the response later

        # 2. Determine list of pages to fetch based on mode
        if chat_request.wiki_mode == "url_only":
            if url_page_title:
                wiki_page_titles = [url_page_title]
                logger.info("Mode: url_only. Using provided URL's title.")
            else:
                logger.warning("Mode: url_only, but no valid title extracted from URL.")
                # Handle error case - maybe provide message back to user
                context = f"Could not process the provided Wikipedia URL: {chat_request.wiki_url}"

        elif chat_request.wiki_mode == "search":
            logger.info("Mode: search. Searching Wikipedia...")
            search_titles = search_wikipedia(search_query)
            wiki_page_titles = search_titles
            logger.info(f"Found {len(wiki_page_titles)} pages via search.")

        elif chat_request.wiki_mode == "both":
            logger.info("Mode: both. Searching Wikipedia and using URL...")
            search_titles = search_wikipedia(search_query)
            logger.info(f"Found {len(search_titles)} pages via search.")
            combined_titles = list(search_titles) # Start with search results
            if url_page_title and url_page_title not in combined_titles:
                combined_titles.insert(0, url_page_title) # Add URL title at the beginning if unique
            wiki_page_titles = combined_titles
            logger.info(f"Combined list has {len(wiki_page_titles)} titles.")

        else:
            logger.warning(f"Invalid wiki_mode received: {chat_request.wiki_mode}. Defaulting to search.")
            search_titles = search_wikipedia(search_query)
            wiki_page_titles = search_titles

        # 3. Get content from selected pages (if any titles were determined)
        if wiki_page_titles:
            logger.info(f"Extracting content for titles: {wiki_page_titles}")
            # Limit number of pages sent to get_wiki_content
            # The 'sources' variable gets populated here based on successful fetches
            context, sources = get_wiki_content(wiki_page_titles[:settings.MAX_WIKI_RESULTS])
            logger.info(f"Extracted context length: {len(context)}, Got {len(sources)} initial sources.")
        elif chat_request.wiki_mode != "url_only" or not url_page_title:
             logger.warning("No Wikipedia pages found or selected to fetch content from.")
             context = f"No relevant Wikipedia pages found for query: '{search_query}'"


        # 4. Format messages and Query Mistral AI
        valid_roles = {"user", "assistant", "system"}
        formatted_messages = [{"role": msg.role, "content": msg.content}
                              for msg in chat_request.messages if msg.role in valid_roles]


        logger.info("Querying Mistral AI...")
        response_content = query_mistral(formatted_messages, context)
        logger.info("Received response from Mistral AI.")

        # Add note about URL failure if applicable
        if chat_request.wiki_url and not url_page_title and chat_request.wiki_mode != 'search':
             response_content = f"(Note: Could not process the provided URL: {chat_request.wiki_url})\n\n{response_content}"

        # <<< START MODIFICATION: Filter sources strictly based on mode >>>
        final_sources = []
        if chat_request.wiki_mode == "url_only":
            if url_page_title:
                # Find the source matching the extracted title
                final_sources=final_sources
            else:
                # If URL was given but title extraction failed, ensure sources is empty
                final_sources = []
                logger.info("Mode url_only: URL provided but title extraction failed, returning empty sources.")
        else:
             # For 'search' or 'both' mode, keep all sources generated by get_wiki_content
             final_sources = sources
             logger.info(f"Mode {chat_request.wiki_mode}: Keeping {len(final_sources)} sources.")
        # <<< END MODIFICATION >>>


        # 5. Return the response and the FINAL filtered sources
        return {
            "response": response_content,
            "sources": final_sources # Use the filtered list
        }

    except HTTPException as http_exc:
        logger.error(f"HTTP Exception: {http_exc.status_code} - {http_exc.detail}", exc_info=True)
        raise # Re-raise HTTPException
    except Exception as e:
        logger.error(f"Error processing chat: {str(e)}", exc_info=True)
        # Return a generic server error response
        raise HTTPException(status_code=500, detail=f"An internal server error occurred: {str(e)}")


if __name__ == "__main__":
    logger.info("Starting WikiGPT application...")
    # Check if running in debug mode (e.g., via environment variable)
    reload_enabled = os.environ.get("WIKIGPT_RELOAD", "false").lower() == "true"
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=reload_enabled)