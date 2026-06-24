# Report target and incidental Business Designer gap resolution

Business Designer agent patches are dispatched for specific target gaps but can affect other gaps on the host block. We decided that task success is judged by target gap fingerprints, while the apply result also reports incidental resolved gaps and newly introduced gaps. This keeps the main success state tied to the requested work while still surfacing side effects that the user must review.
