document.addEventListener('DOMContentLoaded', function() {
  // DOM Elements
  const messagesContainer = document.getElementById('messages');
  const chatForm = document.getElementById('chat-form');
  const userInput = document.getElementById('user-input');
  const sendButton = document.getElementById('send-button');
  const newChatButton = document.getElementById('new-chat-button');
  const chatHistoryList = document.getElementById('chat-history-list');
  const wikiUrlInput = document.getElementById('wiki-url-input'); // New URL input element

  // Debugging
  console.log("DOM loaded, initializing WikiGPT interface");
  console.log("Chat form found:", !!chatForm);
  console.log("User input found:", !!userInput);
  console.log("Wiki URL input found:", !!wikiUrlInput); // Check URL input


  // Chat state
  let currentChatId = generateChatId();
  let chatMessages = []; // Stores {role: 'user'/'assistant', content: '...'}
  let chatHistory = loadChatHistory();

  // Initialize UI
  updateChatHistoryUI();
  loadChat(currentChatId); // Load current or start new

  // Auto-resize textarea
  userInput.addEventListener('input', function() {
      // console.log("Input event triggered"); // Less noisy log
      this.style.height = 'auto';
      this.style.height = (this.scrollHeight) + 'px';
      // Enable/disable send button based on input
      sendButton.disabled = this.value.trim().length === 0;
  });

  // Initial state for send button
  sendButton.disabled = userInput.value.trim().length === 0;


  // Form submission
  chatForm.addEventListener('submit', async function(e) {
      e.preventDefault(); // Prevent default form submission which reloads the page
      console.log("Chat form submitted");

      const message = userInput.value.trim();
      const wikiUrl = wikiUrlInput.value.trim();
      const selectedMode = document.querySelector('input[name="wiki-mode"]:checked').value;


      console.log("User message:", message);
      console.log("Wiki URL:", wikiUrl || "None");
      console.log("Selected Mode:", selectedMode);


      if (!message) {
          console.log("Empty message, not submitting");
          // Maybe provide user feedback here (e.g., highlight input)
          return;
      }

      // --- Actions ---
      // 1. Add user message to UI immediately
      addMessageToUI('user', message); // Add only the text content

      // 2. Prepare message object for history and API
      const userMessageObject = { role: 'user', content: message };
      chatMessages.push(userMessageObject); // Add to current chat state

      // 3. Clear input and reset height
      userInput.value = '';
      userInput.style.height = 'auto';
      sendButton.disabled = true; // Disable send button after sending

      // 4. Show loading indicator
      const loadingId = showLoadingIndicator();
      messagesContainer.scrollTop = messagesContainer.scrollHeight; // Scroll down


      // 5. Send to backend
      try {
          console.log("Sending message and context to backend");
          // Pass the current message as search_query, along with URL and mode
          const response = await sendMessageToBackend(message, chatMessages, wikiUrl, selectedMode);
          console.log("Received response object:", response); // Log the raw response

          // Remove loading indicator BEFORE adding response
          removeLoadingIndicator(loadingId);


          if (response && response.response) { // Check if response and response.response exist
              // Add assistant response to chat state
              chatMessages.push({ role: 'assistant', content: response.response });

              // Add assistant response to UI, including sources if available
              addMessageToUI('assistant', response.response, response.sources);

              // Save updated chat to history (implicitly saves current chat)
              saveCurrentChatToHistory(); // Use a dedicated function
              updateChatHistoryUI(); // Refresh history list
          } else {
               // Handle cases where response is missing or malformed
               console.error("Invalid response received from backend:", response);
               addMessageToUI('assistant', 'Sorry, I received an unexpected response from the server.');
          }
      } catch (error) {
          console.error('Error during chat submission:', error);
          // Ensure loading indicator is removed on error
          removeLoadingIndicator(loadingId);
          addMessageToUI('assistant', `Sorry, an error occurred: ${error.message || 'Unknown error'}. Please try again.`);
      } finally {
          // Always scroll to bottom after response or error
           messagesContainer.scrollTop = messagesContainer.scrollHeight;
      }
  });

  // Create new chat
  newChatButton.addEventListener('click', function() {
      console.log("New chat button clicked");
      // Save the current chat before starting a new one
      saveCurrentChatToHistory();

      // Start new chat session
      currentChatId = generateChatId();
      chatMessages = [];
      messagesContainer.innerHTML = ''; // Clear messages UI

      // Add welcome message to new chat
      const welcomeMessage = createWelcomeMessage();
      messagesContainer.appendChild(welcomeMessage);

      // Clear URL input for new chat
      wikiUrlInput.value = '';
      // Reset mode selector to default ('search')
      document.querySelector('input[name="wiki-mode"][value="search"]').checked = true;


      // Update UI to reflect the new chat session
      updateChatHistoryUI(); // Highlight the "new chat" implicitly
      userInput.focus(); // Focus input for user

  });

  // Example question click
  messagesContainer.addEventListener('click', function(e) { // Listen on messages container
      const exampleQuestion = e.target.closest('.example-questions li');
      if (exampleQuestion) {
          console.log("Example question clicked:", exampleQuestion.textContent);
          userInput.value = exampleQuestion.textContent;
          userInput.dispatchEvent(new Event('input')); // Trigger input event to resize/enable button
          userInput.focus(); // Focus on input field
      }
  });

  // Chat history click
  chatHistoryList.addEventListener('click', function(e) {
      const historyItem = e.target.closest('.chat-history-item');
      if (historyItem) {
          const chatId = historyItem.dataset.chatId;
          console.log("History item clicked, loading chat:", chatId);

          // Save current chat before switching
          saveCurrentChatToHistory();

          // Load the selected chat
          loadChat(chatId);
      }
  });

  // --- Functions ---

  async function sendMessageToBackend(lastMessage, allMessages, wikiUrl, wikiMode) {
      console.log("Preparing API request...");
      const apiUrl = '/chat'; // Ensure this matches your FastAPI route

      // Construct the payload according to the Pydantic model in main.py
      const payload = {
          messages: allMessages.map(msg => ({ role: msg.role, content: msg.content })),
          search_query: lastMessage, // Use the last user message as the primary query topic
          wiki_url: wikiUrl || null, // Send null if URL is empty
          wiki_mode: wikiMode
      };

      console.log("Sending payload:", JSON.stringify(payload, null, 2)); // Pretty print payload


      try {
          const response = await fetch(apiUrl, {
              method: 'POST',
              headers: {
                  'Content-Type': 'application/json',
                  'Accept': 'application/json' // Expect JSON response
              },
              body: JSON.stringify(payload)
          });

          console.log("API response status:", response.status, response.statusText);

          if (!response.ok) {
              // Attempt to read error details from the response body
              let errorText = `API error: ${response.status} ${response.statusText}`;
              try {
                  const errorJson = await response.json();
                  errorText = `API error: ${response.status} - ${errorJson.detail || JSON.stringify(errorJson)}`;
              } catch (jsonError) {
                   errorText = await response.text() || errorText; // Fallback to text body
                  console.warn("Could not parse error response as JSON:", jsonError);
              }
              console.error(errorText);
              throw new Error(errorText); // Throw an error to be caught by the caller
          }

          const data = await response.json(); // Parse successful JSON response
          console.log("API response data:", data);
          return data; // Return the parsed data {response: "...", sources: [...]}

      } catch (error) {
          console.error("Error in sendMessageToBackend fetch:", error);
           // Re-throw the error so the calling function can handle UI updates (e.g., show error message)
          throw error;
      }
  }


  function addMessageToUI(role, content, sources = null) {
      // console.log(`Adding ${role} message to UI`); // Less noisy log

      // Remove welcome message if it exists
       const welcomeMsg = messagesContainer.querySelector('.welcome-message');
       if (welcomeMsg) {
           welcomeMsg.remove();
       }


      const messageDiv = document.createElement('div');
      messageDiv.className = `message ${role}-message`;

      // Avatar
      const avatar = document.createElement('div');
      avatar.className = `message-avatar ${role}-avatar`;
      avatar.textContent = role === 'user' ? 'U' : 'W'; // U for User, W for WikiGPT
      messageDiv.appendChild(avatar);

      // Message content container
      const messageContentDiv = document.createElement('div');
      messageContentDiv.className = 'message-content';
      messageDiv.appendChild(messageContentDiv);

      // Message text (render basic HTML potentially returned by backend)
      const messageText = document.createElement('div');
      messageText.className = 'message-text';
      // Use innerHTML carefully, assuming backend sanitizes or returns safe HTML
      messageText.innerHTML = formatMessageContent(content);
      messageContentDiv.appendChild(messageText);

      // Sources (if available for assistant messages)
      if (role === 'assistant' && sources && sources.length > 0) {
          const sourcesContainer = document.createElement('div');
          sourcesContainer.className = 'message-sources';

          const sourcesHeading = document.createElement('h4');
          sourcesHeading.textContent = 'Sources:';
          sourcesContainer.appendChild(sourcesHeading);

          const sourcesList = document.createElement('ul');
          sourcesList.className = 'sources-list';

          sources.forEach(source => {
              const sourceItem = document.createElement('li');
              const sourceLink = document.createElement('a');
              sourceLink.href = source.url;
              sourceLink.target = '_blank'; // Open in new tab
              sourceLink.rel = 'noopener noreferrer'; // Security best practice
              sourceLink.textContent = source.title || source.url; // Use title or URL
              sourceItem.appendChild(sourceLink);
              sourcesList.appendChild(sourceItem);
          });

          sourcesContainer.appendChild(sourcesList);
          messageContentDiv.appendChild(sourcesContainer);
      }

      messagesContainer.appendChild(messageDiv);

      // Scroll to bottom (might need slight delay sometimes)
       // requestAnimationFrame(() => {
       //     messagesContainer.scrollTop = messagesContainer.scrollHeight;
       // });

  }


  function formatMessageContent(content) {
      // Basic formatting - replace newlines with <br>
      // Assuming backend might return simple HTML like <strong>, <em>
      // If backend returns markdown, you'd need a markdown parser here.
      // For now, just replace newlines.
      // Escape basic HTML tags to prevent XSS if content is purely user-generated
      // For now, assume content from assistant is safe or simple HTML.
      return content.replace(/\n/g, '<br>');
  }

  function showLoadingIndicator() {
      const loadingId = 'loading-' + Date.now();
      const loadingDiv = document.createElement('div');
      loadingDiv.id = loadingId;
      loadingDiv.className = 'message assistant-message loading-indicator'; // Add class for easier removal

      const avatar = document.createElement('div');
      avatar.className = 'message-avatar assistant-avatar';
      avatar.textContent = 'W';
      loadingDiv.appendChild(avatar);

      const loadingContent = document.createElement('div');
      loadingContent.className = 'message-content';

      const loadingDots = document.createElement('div');
      loadingDots.className = 'loading-dots';
      loadingDots.innerHTML = '<span></span><span></span><span></span>'; // Animated dots

      loadingContent.appendChild(loadingDots);
      loadingDiv.appendChild(loadingContent);

      messagesContainer.appendChild(loadingDiv);
      // messagesContainer.scrollTop = messagesContainer.scrollHeight; // Scroll after adding

      return loadingId; // Return ID to allow removal
  }

  function removeLoadingIndicator(loadingId) {
      const loadingElement = document.getElementById(loadingId);
      if (loadingElement) {
          loadingElement.remove();
           console.log("Removed loading indicator:", loadingId);
      } else {
          // Fallback: Remove any element with the loading class if ID fails
           const genericLoading = messagesContainer.querySelector('.loading-indicator');
           if(genericLoading) {
               genericLoading.remove();
               console.warn("Removed loading indicator by class, ID match failed:", loadingId);
           }
      }
  }


  function generateChatId() {
      // Simple unique ID generator
      return 'chat-' + Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
  }

  function loadChatHistory() {
      const historyJson = localStorage.getItem('wikiGPT_chatHistory');
      let history = {};
      if (historyJson) {
          try {
             history = JSON.parse(historyJson);
             // Optional: Add validation here to ensure structure is correct
          } catch (e) {
              console.error("Error parsing chat history from localStorage:", e);
              localStorage.removeItem('wikiGPT_chatHistory'); // Clear corrupted history
              history = {};
          }
      }
       // Ensure keys match the expected format if needed (e.g., all start with 'chat-')
       // history = Object.fromEntries(Object.entries(history).filter(([key]) => key.startsWith('chat-')));
      return history;
  }

  // Save the currently active chat (currentChatId, chatMessages) to history
  function saveCurrentChatToHistory() {
       if (chatMessages.length === 0) {
           console.log("Current chat is empty, not saving to history.");
           // Optionally remove empty chat from history if it exists
           if (chatHistory[currentChatId]) {
                delete chatHistory[currentChatId];
                localStorage.setItem('wikiGPT_chatHistory', JSON.stringify(chatHistory));
                console.log("Removed empty chat placeholder from history:", currentChatId);
           }
           return;
       }; // Don't save empty chats


      // Determine title from first user message
      let title = 'Chat ' + new Date(parseInt(currentChatId.split('-')[1], 36)).toLocaleTimeString(); // Default title
      const firstUserMessage = chatMessages.find(msg => msg.role === 'user');
      if (firstUserMessage) {
          title = firstUserMessage.content.substring(0, 40) + (firstUserMessage.content.length > 40 ? '...' : '');
      }

      // Create or update history entry
      chatHistory[currentChatId] = {
          id: currentChatId,
          title: title,
          timestamp: Date.now(), // Update timestamp on save
          messages: [...chatMessages] // Store a copy of messages
      };

      // Save updated history object back to localStorage
      try {
           localStorage.setItem('wikiGPT_chatHistory', JSON.stringify(chatHistory));
           console.log(`Saved chat ${currentChatId} ('${title}') to history.`);
      } catch (e) {
           console.error("Error saving chat history to localStorage:", e);
           // Handle potential storage limit issues
           alert("Could not save chat history. Storage might be full.");
      }
  }


  function updateChatHistoryUI() {
      chatHistoryList.innerHTML = ''; // Clear existing list

      // Get chats from history object, sort by timestamp (newest first)
      const sortedChats = Object.values(chatHistory)
          .sort((a, b) => b.timestamp - a.timestamp);

      console.log(`Updating history UI with ${sortedChats.length} chats.`);


      if (sortedChats.length === 0) {
          chatHistoryList.innerHTML = '<div class="no-history">No chat history yet.</div>'; // Placeholder message
          return;
      }


      sortedChats.forEach(chat => {
          const historyItem = document.createElement('div');
          historyItem.className = 'chat-history-item';
          historyItem.dataset.chatId = chat.id; // Store chat ID for loading

          // Highlight the currently active chat
          if (chat.id === currentChatId) {
              historyItem.classList.add('active');
          }

          // Icon
          const chatIcon = document.createElement('i');
          chatIcon.className = 'fas fa-comment'; // Font Awesome icon
          historyItem.appendChild(chatIcon);

          // Title (escape HTML just in case)
          const chatTitle = document.createElement('span'); // Use span for text
          chatTitle.textContent = chat.title || 'Untitled Chat'; // Use default if title missing
          historyItem.appendChild(chatTitle);


          // Optional: Add delete button per item
          // const deleteBtn = document.createElement('button');
          // deleteBtn.innerHTML = '&times;'; // Simple 'x'
          // deleteBtn.className = 'delete-chat-btn';
          // deleteBtn.onclick = (event) => {
          //     event.stopPropagation(); // Prevent triggering loadChat
          //     deleteChat(chat.id);
          // };
          // historyItem.appendChild(deleteBtn);


          chatHistoryList.appendChild(historyItem);
      });
  }

  // Optional: Function to delete a specific chat
  // function deleteChat(chatId) {
  //     if (confirm(`Are you sure you want to delete chat "${chatHistory[chatId]?.title || chatId}"?`)) {
  //         delete chatHistory[chatId];
  //         localStorage.setItem('wikiGPT_chatHistory', JSON.stringify(chatHistory));
  //         updateChatHistoryUI();
  //         // If deleting the current chat, start a new one
  //         if (chatId === currentChatId) {
  //             newChatButton.click();
  //         }
  //         console.log("Deleted chat:", chatId);
  //     }
  // }


  function loadChat(chatId) {
      console.log("Attempting to load chat:", chatId);

      // Check if the chat exists in history
      if (chatHistory[chatId]) {
          const chatData = chatHistory[chatId];
          console.log(`Loading chat '${chatData.title}'`);

          // Set current chat state
          currentChatId = chatId;
          chatMessages = [...chatData.messages]; // Load messages

          // Update UI
          messagesContainer.innerHTML = ''; // Clear current messages
          chatMessages.forEach(msg => {
               // We don't store sources in history, so pass null
              addMessageToUI(msg.role, msg.content, null);
          });

           // Scroll to bottom after loading messages
          messagesContainer.scrollTop = messagesContainer.scrollHeight;


          // Clear URL input when loading a chat (or restore if saved)
          wikiUrlInput.value = ''; // Simple approach: clear URL on load
          // Reset mode selector to default ('search')
           document.querySelector('input[name="wiki-mode"][value="search"]').checked = true;

          updateChatHistoryUI(); // Update highlighting in history list

      } else {
           console.warn("Chat ID not found in history, starting new chat:", chatId);
           // If chat ID is somehow invalid, start a fresh chat
           newChatButton.click();
      }
       userInput.focus();
  }

  // Create welcome message element
  function createWelcomeMessage() {
      const welcomeDiv = document.createElement('div');
      welcomeDiv.className = 'welcome-message';

      const heading = document.createElement('h3');
      heading.textContent = 'Welcome to WikiGPT!';
      welcomeDiv.appendChild(heading);

      const intro = document.createElement('p');
      intro.textContent = 'Ask me anything! I can search Wikipedia or use a specific article URL you provide.';
      welcomeDiv.appendChild(intro);

      const exampleQuestions = document.createElement('div');
      exampleQuestions.className = 'example-questions';

      const exampleHeading = document.createElement('p');
      exampleHeading.textContent = 'Try asking:';
      exampleQuestions.appendChild(exampleHeading);

      const questionsList = document.createElement('ul');
      const questions = [
          "What were the major causes of World War II?",
          "Explain quantum computing in simple terms.",
          "Tell me about the history of chess.",
          "What is photosynthesis and how does it work?"
      ];

      questions.forEach(q => {
          const item = document.createElement('li');
          item.textContent = q;
          questionsList.appendChild(item); // Append to list
      });

      exampleQuestions.appendChild(questionsList); // Append list to container
      welcomeDiv.appendChild(exampleQuestions); // Append examples to welcome message

      return welcomeDiv;
  }

  // --- Initialization ---
  // Load the last active chat or start a new one
  const lastActiveChatId = localStorage.getItem('wikiGPT_lastActiveChatId');
  if (lastActiveChatId && chatHistory[lastActiveChatId]) {
       console.log("Loading last active chat:", lastActiveChatId);
       loadChat(lastActiveChatId);
  } else {
       console.log("No valid last active chat found, starting new chat.");
       // Ensure a welcome message is shown if starting completely fresh
       if (Object.keys(chatHistory).length === 0) {
            messagesContainer.appendChild(createWelcomeMessage());
       } else {
           // If history exists but no last active, load the most recent
            const mostRecentChat = Object.values(chatHistory).sort((a, b) => b.timestamp - a.timestamp)[0];
            if(mostRecentChat) {
                loadChat(mostRecentChat.id);
            } else {
                 messagesContainer.appendChild(createWelcomeMessage()); // Fallback
            }
       }

  }


   // Save the active chat ID when the page is closed/reloaded
   window.addEventListener('beforeunload', () => {
       if (currentChatId) {
           localStorage.setItem('wikiGPT_lastActiveChatId', currentChatId);
           saveCurrentChatToHistory(); // Ensure latest state is saved
            console.log("Saving last active chat ID:", currentChatId);
       }
   });


  console.log("WikiGPT UI initialized");
});