# All model calls go through one server-side provider layer

Every call to Gemini, OpenRouter (JEV and chat models), Groq and local Laya goes through one provider layer in the
server, which owns the API keys, pacing, retries, cost counting and the request log. App verification, Tafrigh and the
datagen's teachers all use it, and the browser holds no keys and calls no provider. Reason: the old code called
Gemini from 4 files and OpenRouter from 8 (browser and server), each with its own retry and cost logic, so evaluation results for a
teacher didn't necessarily describe the code the app ran.
