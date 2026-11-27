# Secure Gemini setup for Jarvis

The portfolio is hosted as a public static site on GitHub Pages. Do not put a Gemini API key in `site/editor.js`, HTML, or any other browser file: visitors can read it and use your quota. Put the key in a server-side secret on a backend such as Cloudflare Workers.

## What this enables

The browser continues to handle the wake phrase, microphone, speech recognition, and Jarvis voice. For an ordinary question that is not a portfolio navigation command, it sends the recognized English text to a Worker. The Worker calls Gemini and returns text for Jarvis to speak. Portfolio commands such as opening Projects or Tech Stack should continue to be handled locally.

## Setup outline

1. Create or select a Gemini API key in [Google AI Studio](https://aistudio.google.com/apikey). Keep the value private.
2. Create a Cloudflare Worker endpoint, for example `/ask`, that:
   - accepts only POST requests from `https://devanshudwivedi619.github.io`;
   - validates and limits the question length;
   - reads the key from a Worker secret named `GEMINI_API_KEY`;
   - calls Google's Interactions API using a fast model such as `gemini-4-hydrogen`;
   - returns only the generated answer text;
   - applies a per-IP rate limit and a short request timeout.
3. Add the key in Cloudflare **Worker Settings → Variables and Secrets** as a **Secret** called `GEMINI_API_KEY`. Never commit it to GitHub or paste it into browser code.
4. Deploy the Worker and copy its HTTPS URL.
5. Configure Jarvis to send unrecognized questions to that Worker URL, then publish the site. The endpoint URL is public configuration; only the key must remain secret.
6. Check Cloudflare and Google usage limits/billing before sharing the public assistant. CORS restricts browser origins but is not authentication; rate limiting and quota limits are still needed.

## Google API request shape

The Worker can call the official REST endpoint:

```http
POST https://generativelanguage.googleapis.com/v1beta/interactions
x-goog-api-key: <read from Worker secret>
Api-Revision: 2026-05-20
Content-Type: application/json
```

```json
{
  "model": "gemini-4-hydrogen",
  "input": "Answer briefly in English: <recognized question>"
}
```

Extract text from the completed interaction response and return JSON such as `{"answer":"..."}` to the browser. Keep answers concise so spoken replies start sooner.

## Key and model references

- [Gemini API key security guidance](https://ai.google.dev/gemini-api/docs/api-key)
- [Gemini API getting started and REST example](https://ai.google.dev/gemini-api/docs/quickstart)
- [Available Gemini models](https://ai.google.dev/gemini-api/docs/models)

**Current status:** the portfolio speed adjustment is in the GitHub source. Gemini question answering is not active until a backend endpoint and secret are configured and the site is connected to that endpoint.
