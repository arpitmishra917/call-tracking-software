# Git Workflow

The current recommended Git model utilizes feature branches to keep the main branch stable.

## Branches
- main: The stable integration branch. All code here should be verified and deployable.
- rontend-dev: Frontend development.
- ackend-dev: Backend development.
- documentation: Documentation changes.

## Basic Concepts
- **Branch**: An isolated line of development.
- **Commit**: A saved snapshot of your changes.
- **Push**: Uploading your local commits to the remote repository.
- **Pull**: Downloading changes from the remote repository to your local machine.
- **Merge**: Combining changes from one branch into another.
- **Conflict**: When two branches modify the same part of a file differently, requiring manual resolution.
- **Worktree**: A Git feature that allows you to check out multiple branches at once in different directories, useful for working on frontend and backend simultaneously without switching branches in a single directory.

## Best Practices
1. Never commit directly to main.
2. Keep commits small and descriptive.
3. Pull regularly to avoid large merge conflicts.
