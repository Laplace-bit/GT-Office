# Return Business Designer graph projection from validation

Business Designer gaps and derived links come from the same interpretation of the current document. We decided that v1 extends `validate_document` to return diagnostics, gaps, rule runs, revision, and a derived graph projection in one snapshot rather than adding a separate graph projection command. This keeps the frontend from combining health data and visual graph data computed from different document revisions.
