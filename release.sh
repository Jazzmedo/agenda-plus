#!/usr/bin/env bash
# Test and build the AgendaPlus Obsidian plugin and publish it as a GitHub
# release with the three files Obsidian needs (main.js, manifest.json,
# styles.css).
#
#   ./release.sh            asks for the tag, confirms, tests, builds, tags, pushes, uploads
#   ./release.sh --dry-run  only tests and builds the current version (no commit, tag, push or upload)
#
# The release notes default to the "## Unreleased" section of CHANGELOG.md,
# which becomes "## <version> — <date>".
# Needs: git, gh (logged in: gh auth login), node and npm.
set -euo pipefail
cd "$(dirname "$0")"

REPO=Jazzmedo/agenda-plus
BRANCH=main
MANIFEST=manifest.json
VERSIONS=versions.json
DRY_RUN=0
[[ ${1:-} == --dry-run ]] && DRY_RUN=1

if [[ -t 1 ]]; then
    B=$'\e[1m' DIM=$'\e[2m' RED=$'\e[31m' GRN=$'\e[32m' YLW=$'\e[33m' BLU=$'\e[34m' R=$'\e[0m'
else
    B='' DIM='' RED='' GRN='' YLW='' BLU='' R=''
fi
step() { printf '\n%s==>%s %s%s%s\n' "$BLU" "$R" "$B" "$*" "$R"; }
ok()   { printf '%s✓%s %s\n' "$GRN" "$R" "$*"; }
warn() { printf '%s!%s %s\n' "$YLW" "$R" "$*"; }
die()  { printf '%s✗ %s%s\n' "$RED" "$*" "$R" >&2; exit 1; }

current_version() { node -p "require('./$MANIFEST').version"; }

# Set manifest.json's version and add the matching entry to versions.json
# (plugin version -> minimum app version), keeping the files valid JSON with
# tab indentation and the newest version first.
set_version() {
    node -e '
        const fs = require("fs");
        const version = process.argv[1];
        const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
        manifest.version = version;
        fs.writeFileSync("manifest.json", JSON.stringify(manifest, "\t") + "\n");
        const versions = JSON.parse(fs.readFileSync("versions.json", "utf8"));
        const min = manifest.minAppVersion;
        const out = { [version]: versions[version] ?? min };
        for (const [v, m] of Object.entries(versions)) if (v !== version) out[v] = m;
        fs.writeFileSync("versions.json", JSON.stringify(out, "\t") + "\n");
    ' "$1"
}

# The body of one "## <heading>" section of CHANGELOG.md.
changelog_section() {
    awk -v want="$1" '
        /^## / { if (found) exit; found = (index($0, "## " want) == 1); next }
        found' CHANGELOG.md | sed -e '/./,$!d' | sed -e ':a' -e '/^\n*$/{$d;N;ba' -e '}'
}

# ---------------------------------------------------------------- checks
step "Checking"
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "Not a git repository."
for tool in node npm zip; do
    command -v "$tool" >/dev/null || die "$tool is needed."
done
branch=$(git symbolic-ref --short HEAD 2>/dev/null || true)
if (( DRY_RUN )); then
    [[ -z $(git status --porcelain) ]] || warn "Uncommitted changes will be included in this test build."
else
    [[ $branch == "$BRANCH" ]] || die "Switch to '$BRANCH' first (you are on '${branch:-a detached HEAD}')."
    [[ -z $(git status --porcelain) ]] || die "Commit or stash your changes first (git status)."
    command -v gh >/dev/null || die "Install the GitHub CLI (gh)."
    gh auth status >/dev/null 2>&1 || die "Log in to GitHub first: gh auth login"
    git fetch --quiet --tags origin "$BRANCH" || die "Couldn't reach origin."
    behind=$(git rev-list --count "HEAD..origin/$BRANCH")
    (( behind == 0 )) || die "Your '$BRANCH' is $behind commit(s) behind origin. Run: git pull"
fi
ok "Ready"

version=$(current_version)
[[ -n $version ]] || die "Couldn't read the version from $MANIFEST."
last_tag=$(git describe --tags --abbrev=0 2>/dev/null || echo "none yet")
printf '  Version in the manifest: %s%s%s\n  Last release tag:        %s%s%s\n' "$B" "$version" "$R" "$B" "$last_tag" "$R"

# ---------------------------------------------------------------- questions
if (( DRY_RUN )); then
    tag="v$version"
    notes=""
else
    while true; do
        read -rp "${B}Release tag${R} (e.g. v$version): " tag
        tag=${tag// /}
        [[ $tag == [0-9]* ]] && tag="v$tag"
        if [[ ! $tag =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]]; then
            warn "Use the form v1.2.3 (or v1.2.3-beta.1)."
        elif git rev-parse -q --verify "refs/tags/$tag" >/dev/null \
                || git ls-remote --exit-code --tags origin "refs/tags/$tag" >/dev/null 2>&1; then
            warn "$tag already exists."
        else
            break
        fi
    done
    read -rp "${B}Release notes${R} (one line; empty = the changelog section): " notes
fi
new_version=${tag#v}

# Notes: what was typed, else the changelog, else GitHub's list of commits.
unreleased=$(changelog_section "Unreleased")
[[ -n $unreleased ]] || unreleased=$(changelog_section "$new_version")
if [[ -z $notes && -n $unreleased ]]; then
    notes_source="CHANGELOG.md"
elif [[ -n $notes ]]; then
    notes_source="typed"
else
    notes_source="generated from commits"
fi

files=("dist/agenda-plus-$new_version.zip" dist/main.js dist/manifest.json dist/styles.css)

printf '\n%sSummary%s\n' "$B" "$R"
printf '  Repository:  https://github.com/%s\n' "$REPO"
printf '  Tag:         %s%s%s\n' "$B" "$tag" "$R"
printf '  Version:     %s -> %s\n' "$version" "$new_version"
printf '  Notes:       %s\n' "$notes_source"
printf '  Files:\n'; printf '    %s\n' "${files[@]}"
if (( DRY_RUN )); then
    printf '  %sDry run: tests and builds only; nothing is committed, tagged, pushed or uploaded.%s\n' "$YLW" "$R"
else
    printf '  This commits "Release %s", pushes %s and the tag, and publishes the release.\n' "$tag" "$BRANCH"
    read -rp "${B}Are you sure? [y/N]${R} " answer
    [[ $answer =~ ^[Yy]([Ee][Ss])?$ ]] || die "Cancelled. Nothing was changed."
fi

# ---------------------------------------------------------------- version bump
bumped=0
restore() {
    if (( bumped )); then
        git checkout -- "$MANIFEST" "$VERSIONS" CHANGELOG.md
        warn "The release failed; the version change was undone. Nothing was pushed."
    fi
}
trap restore ERR

if (( ! DRY_RUN )) && [[ $new_version != "$version" ]]; then
    step "Setting version $new_version"
    set_version "$new_version"
    [[ $(current_version) == "$new_version" ]] || die "Couldn't set the version in $MANIFEST."
    bumped=1
fi
if (( ! DRY_RUN )) && grep -q '^## Unreleased$' CHANGELOG.md; then
    sed -i "s/^## Unreleased$/## $new_version — $(date +%F)/" CHANGELOG.md
    bumped=1
fi

# ---------------------------------------------------------------- test and build
step "Testing"
[[ -d node_modules ]] || npm ci --silent
npm test --silent
ok "Tests passed"

step "Building the plugin"
npm run build --silent
rm -rf dist && mkdir -p dist
for f in main.js manifest.json styles.css; do
    [[ -s $f ]] || die "Missing build output: $f"
    cp "$f" "dist/$f"
done
# The three loose files stay because Obsidian's marketplace and update checker
# download assets by those exact names; the zip is for manual installs.
zipfile="agenda-plus-$new_version.zip"
(cd dist && zip -q "$zipfile" main.js manifest.json styles.css)
[[ -s "dist/$zipfile" ]] || die "Couldn't create $zipfile"
ok "Built:"
ls -lh dist | awk 'NR > 1 {print "    " $5 "  " $NF}'
trap - ERR

if (( DRY_RUN )); then
    printf '\n%sDry run finished.%s The files are in dist/.\n' "$GRN" "$R"
    exit 0
fi

# ---------------------------------------------------------------- publish
step "Tagging $tag and pushing"
if (( bumped )); then
    git add "$MANIFEST" "$VERSIONS" CHANGELOG.md
    git commit -q -m "Release $tag"
fi
git tag -a "$tag" -m "AgendaPlus $new_version"
git push --quiet origin "$BRANCH"
git push --quiet origin "$tag"
ok "Pushed $BRANCH and $tag"

step "Creating the GitHub release"
args=(--repo "$REPO" --title "AgendaPlus $new_version" --verify-tag)
if [[ -n $notes ]]; then
    args+=(--notes "$notes")
elif [[ -n $unreleased ]]; then
    args+=(--notes "$unreleased")
else
    args+=(--generate-notes)
fi
gh release create "$tag" "${files[@]}" "${args[@]}"

printf '\n%s✓ Released %s%s  https://github.com/%s/releases/tag/%s\n' "$GRN$B" "$tag" "$R" "$REPO" "$tag"
printf '%sObsidian installs the three files from this release; once the plugin is listed in\ncommunity-plugins.json, updates reach users automatically — no new PR needed per release.%s\n' "$DIM" "$R"
