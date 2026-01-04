console.log("AI RoundTable Background Service Worker Loaded");

chrome.runtime.onInstalled.addListener(() => {
  console.log("AI RoundTable Extension Installed");
});

// Setup connection listeners and message routing here
