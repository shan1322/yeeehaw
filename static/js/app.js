// static/js/script.js

async function sendMessage() {
    const inputElement = document.getElementById("user-input");
    const chatbox = document.getElementById("chat-box");
    const userText = inputElement.value.trim();
    if (userText === "") return;

    // Add user message to chatbox
    chatbox.innerHTML += `<div class="message user">${userText}</div>`;
    inputElement.value = "";

    try {
        const res = await fetch('/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question: userText })
        });

        const data = await res.json();

        chatbox.innerHTML += `<div class="message bot">${data.answer}</div>`;
        chatbox.scrollTop = chatbox.scrollHeight;
    } catch (err) {
        chatbox.innerHTML += `<div class="message bot error">Error: ${err.message}</div>`;
    }
}
