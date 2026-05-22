# AI RoundTable Advanced

This is the local unpacked Advanced build for attachment upload experiments.

It declares Chrome debugger and downloads permissions so it can stage selected
files under Downloads/AI-RoundTable-temp and inject them through CDP
DOM.setFileInputFiles. Load this folder only through chrome://extensions
developer mode. The Chrome Web Store Lite build remains manifest.json.

Temporary files are scheduled for cleanup after each success or failure.
