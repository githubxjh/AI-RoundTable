export const Storage = {
    get: async (keys) => {
        return await chrome.storage.local.get(keys);
    },
    set: async (items) => {
        return await chrome.storage.local.set(items);
    }
};
