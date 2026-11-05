# One GPU owner; one model in VRAM at a time

A single GPU owner in the server decides which model (Whisper, specialized Whisper or Laya) is loaded on the 3 GB GTX
1050. Jobs ask it for a model and wait until it is theirs; it unloads whatever else is there first. No other code
loads models onto the GPU. Reason: in the old code each module loaded its own model and Laya unloaded Whisper through
a callback, so running two jobs at once could run out of memory or silently fall back to CPU, about 30 times slower.
