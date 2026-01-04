import { Storage } from '../utils/storage.js';

console.log("Sidepanel Loaded");

document.addEventListener('DOMContentLoaded', () => {
    // Initialize UI listeners
    const sendBtn = document.getElementById('send-btn');
    if (sendBtn) {
        sendBtn.addEventListener('click', () => {
            console.log("Send clicked");
        });
    }
});
