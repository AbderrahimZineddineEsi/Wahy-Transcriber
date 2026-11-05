# One envelope builder; datasets store the final envelopes

Envelopes are built only by `engine/` (one function per envelope version). The dataset builder stores each row's
envelope in its final form, and training and evaluation code (Kaggle scripts, notebooks) read it as-is and never
reshape it. The app builds envelopes with the same function at verification time. Reason: in the old code six
functions in two languages built envelopes, and run 6 found the notebook's `to_v3_state` disagreeing with the app's
`buildLayaEnvelopeV3`: the model was trained on one input shape and served another.

## Consequences

Changing an envelope means adding a new version, rebuilding the dataset and training a new checkpoint. Old
checkpoints keep working because each one records the envelope version it expects.
