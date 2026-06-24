# Limit Business Designer v1 agent patches to the host block

Business Designer v1 keeps anchored agent completion narrow: both single-gap and block-scope agent patches may only change the host block. We decided not to let v1 anchored patches create or modify adjacent blocks, because that requires additional semantics for relation choice, layout, naming, ownership, and undo. Neighborhood creation can be introduced later as an explicit scope rather than hidden inside block completion.
