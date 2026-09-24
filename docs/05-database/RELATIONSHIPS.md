# Relationships
```mermaid
erDiagram
    Workspace ||--o{ WorkspaceMember : contains
    Workspace ||--o{ PhoneNumber : owns
    Workspace ||--o{ Campaign : owns
    Workspace ||--o{ Buyer : owns
    Campaign ||--o{ CampaignBuyer : includes
    Buyer ||--o{ CampaignBuyer : assigned_to
    Campaign ||--o{ Call : routes
```
