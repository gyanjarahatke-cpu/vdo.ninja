# Manual Upstream Sync

MCast's VDO fork must not auto-sync with `steveseguin/vdo.ninja`.

Use this only when we intentionally want upstream VDO.Ninja changes:

```powershell
git remote add upstream https://github.com/steveseguin/vdo.ninja.git
git fetch upstream
git checkout develop
git merge --no-ff upstream/develop
```

After resolving conflicts, test `/g/`, `/vcall/`, `mcast-route.js`, and all MCast-specific changes before pushing to `origin/develop`.

Remove the temporary upstream remote after sync if it is not needed:

```powershell
git remote remove upstream
```
