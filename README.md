# DP Intelligence — your personal AI

DP Intelligence runs an open model directly in your browser, so you do not need an AI API key or paid AI account. It streams detailed responses, can search the live web, suggests three clickable follow-up questions, and keeps conversations in your browser.

## Start DP Intelligence

1. Install Node.js 20 or newer if it is not already installed.
2. Open a terminal in this folder and run `npm start`.
3. Visit [http://localhost:4173](http://localhost:4173).
4. Create a local profile with your email and phone number.
5. Ask a question. The first model download can take a few minutes; later chats reuse the browser cache.

The default Llama 3.2 3B model gives stronger answers and needs a WebGPU-compatible browser and about 2.3 GB of graphics memory. Choose the smaller 1B model in your profile for faster replies and a smaller download. Keep the browser open while the model downloads. A local model has less capability than large hosted AI services, but web search can ground answers in current sources.

## Profile and privacy

The email and phone fields create a local profile label only. DP Intelligence does not verify them, send them, or provide a cross-device account. Profile details and conversations stay in this browser's local storage. AI answers are generated on your device. Web search sends the search query to DuckDuckGo so it can return public results. The first time you run the app, its public model files and runtime are downloaded from their publishers. When run locally, the server binds only to your own computer (`127.0.0.1`).

## Publish DP Intelligence on the internet

This project includes a `render.yaml` deployment recipe for Render. To publish it, put this folder in a GitHub repository, sign in to Render, choose **New → Blueprint**, connect that repository, and deploy the `dp-intelligence` service. Render will provide an HTTPS address when deployment finishes. The server listens on the public interface and uses Render's assigned port; the API endpoints have a basic per-IP request limit.

The hosted site still runs the AI model in each visitor's browser. Visitors need a compatible browser and enough memory to download and run the selected model; the first visit may download about 2.3 GB for the 3B model. Free hosting may pause while idle and take longer to wake. This profile is not a real account: email and phone are saved only in that visitor's browser and are not verified or collected by the site. Web search queries go through the hosted server to DuckDuckGo; image searches go to Wikimedia Commons. Public deployment makes the site available to anyone with its link.
