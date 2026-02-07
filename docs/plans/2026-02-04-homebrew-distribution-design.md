# Homebrew Distribution Design

## Goal

Make murmur installable with a single command on any Mac or Linux machine:

```bash
brew install t0dorakis/murmur/murmur
```

No prerequisites beyond Homebrew and Claude CLI. No Bun, Node, or npm knowledge required.

## How It Works

Homebrew taps are Git repos named `homebrew-<name>` containing Ruby formula files. When a user runs `brew install t0dorakis/murmur/murmur`, Homebrew clones the tap, reads the formula, installs dependencies (Bun), downloads the source tarball, and runs the build steps locally.

The formula calls `bun build --compile` on the user's machine, producing a native standalone binary. This avoids shipping prebuilt platform-specific binaries and eliminates the need for macOS CI runners.

## Components

### 1. Homebrew Tap Repository

**Repo:** `t0dorakis/homebrew-murmur` (public, on GitHub)

**File:** `Formula/murmur.rb`

```ruby
class Murmur < Formula
  desc "Scheduled Claude prompts that only speak when something needs attention"
  homepage "https://github.com/t0dorakis/murmur"
  url "https://github.com/t0dorakis/murmur/archive/refs/tags/v0.1.0.tar.gz"
  sha256 "<sha256-of-tarball>"
  license "MIT"

  depends_on "bun"

  def install
    system "bun", "install"
    system "bun", "build", "--compile", "src/cli.ts", "--outfile", "murmur"
    bin.install "murmur"
  end

  test do
    assert_match "murmur", shell_output("#{bin}/murmur --help")
  end
end
```

### 2. GitHub Actions Release Workflow

**File:** `.github/workflows/release.yml`

Triggered on tag push (`v*`). Runs on a single `ubuntu-latest` runner (free tier). Steps:

1. Check out code
2. Install Bun
3. Run `bun test`
4. Create a GitHub Release with auto-generated release notes
5. Download the source tarball and compute its SHA256 hash
6. Clone the `homebrew-murmur` tap repo
7. Update the formula with the new version URL and hash
8. Commit and push to the tap repo

```yaml
name: Release
on:
  push:
    tags: ["v*"]

permissions:
  contents: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bun test

      - uses: softprops/action-gh-release@v2
        with:
          generate_release_notes: true

      - name: Get tarball hash
        id: hash
        run: |
          VERSION=${GITHUB_REF#refs/tags/}
          curl -sL "https://github.com/${{ github.repository }}/archive/refs/tags/$VERSION.tar.gz" -o release.tar.gz
          SHA=$(sha256sum release.tar.gz | cut -d' ' -f1)
          echo "sha256=$SHA" >> "$GITHUB_OUTPUT"
          echo "version=${VERSION#v}" >> "$GITHUB_OUTPUT"

      - name: Update Homebrew formula
        env:
          TAP_GITHUB_TOKEN: ${{ secrets.TAP_GITHUB_TOKEN }}
        run: |
          git clone https://x-access-token:${TAP_GITHUB_TOKEN}@github.com/t0dorakis/homebrew-murmur.git tap
          cd tap
          sed -i "s|url \".*\"|url \"https://github.com/${{ github.repository }}/archive/refs/tags/v${{ steps.hash.outputs.version }}.tar.gz\"|" Formula/murmur.rb
          sed -i "s|sha256 \".*\"|sha256 \"${{ steps.hash.outputs.sha256 }}\"|" Formula/murmur.rb
          sed -i "s|version \".*\"|version \"${{ steps.hash.outputs.version }}\"|" Formula/murmur.rb
          git config user.name "github-actions"
          git config user.email "actions@github.com"
          git add Formula/murmur.rb
          git commit -m "Update murmur to v${{ steps.hash.outputs.version }}"
          git push
```

### 3. Secrets

| Secret             | Purpose                                                     |
| ------------------ | ----------------------------------------------------------- |
| `TAP_GITHUB_TOKEN` | GitHub PAT with write access to `t0dorakis/homebrew-murmur` |

Create via GitHub Settings > Developer settings > Personal access tokens > Fine-grained tokens. Grant `Contents: Read and write` permission on the `homebrew-murmur` repo only.

## Setup Checklist

1. Add a LICENSE file to the murmur repo (Homebrew expects one)
2. Create the `t0dorakis/homebrew-murmur` public repo on GitHub
3. Add `Formula/murmur.rb` with placeholder values
4. Create a fine-grained PAT scoped to the tap repo
5. Add the PAT as `TAP_GITHUB_TOKEN` secret in the murmur repo
6. Add `.github/workflows/release.yml` to the murmur repo
7. Remove `"private": true` from `package.json` (or keep it — Homebrew installs from the tarball, not npm)

## Release Process

```bash
git tag v0.1.0
git push origin v0.1.0
```

CI runs tests, creates the GitHub Release, and updates the Homebrew formula automatically.

## User Experience

```bash
# First install
brew install t0dorakis/murmur/murmur

# Verify
murmur --help

# Upgrade
brew upgrade murmur
```

## Future Additions

If Linux users without Homebrew need support, add a `curl | sh` install script that downloads cross-compiled binaries from GitHub Releases. Bun supports cross-compilation from Linux (`bun build --compile --target=bun-linux-x64`), so no additional CI runners would be needed.
