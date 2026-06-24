# Create minimal blocks from brief selections

Business Designer v1 lets users grow structure from a brief without pretending the system understood unstated details. We decided that actions such as "model as entity" create only the minimal block directly implied by the selection, such as an entity name with empty fields, and then expose gaps for completion. This avoids implicit NLP field extraction in v1 and keeps generated structure traceable to explicit user intent or reviewed agent patches.
