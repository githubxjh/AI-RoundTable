class AIAdapter {
    constructor(name) {
        this.name = name;
        this.init();
    }

    init() {
        console.log(`${this.name} Adapter Initialized`);
        // Setup MutationObserver and Input Simulation logic here
    }

    sendMessage(text) {
        console.log(`${this.name} sending message: ${text}`);
    }
}

// Make it available globally or export if using modules (content scripts run in isolation)
window.AIAdapter = AIAdapter;
