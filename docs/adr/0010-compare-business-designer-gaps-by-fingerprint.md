# Compare Business Designer gaps by fingerprint

Business Designer gap ids are useful inside a validation snapshot, but some gaps do not have a perfectly stable business locator. We decided that gap resolution compares semantic fingerprints made from the host block, gap code, and the best available normalized locator, while ids may be hashes of those fingerprints. Locators based on block-local paths or ordinals are allowed as a fallback, but the system must not treat gap ids as long-lived persistent identities.
