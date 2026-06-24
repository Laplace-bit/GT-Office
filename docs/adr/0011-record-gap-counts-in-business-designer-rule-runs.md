# Record gap counts in Business Designer rule runs

Business Designer rules can produce zero, one, or many gaps for the same block. We decided that `DesignerRuleRun` should record `gapCount` alongside `passed`, with `passed` defined as `gapCount === 0`, rather than storing only a boolean. This keeps rule execution auditable without making `rulesRun` the frontend's primary gap data source.
