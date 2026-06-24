# Derive Business Designer links in the backend

Business Designer links carry semantic meaning used by gap rules, not just visual drawing state. We decided that Rust validation is the sole source of truth for deriving links from block content, while the frontend owns only graph view models, layout coordinates, paths, hit testing, and interaction state. This avoids separate TypeScript and Rust interpretations of relation vocabulary, dangling references, and cross-block rules.
