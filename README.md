# dndcs — D&D Character Sheet

A local web application for managing a D&D character sheet. Run a local server and edit your character sheet in the browser.

## Setup

Requires [uv](https://github.com/astral-sh/uv):

```bash
make setup
```

## Running

```bash
uv run bin/dndcs.py <character_file.yaml>
```

Options:

| Flag | Default | Description |
| :--- | :--- | :--- |
| `<sheet>` | *(required)* | Path to the character YAML file |
| `--out <path>` | same as `<sheet>` | Where to write saves (original overwritten if omitted) |
| `--port <n>` | `9123` | Port for the local web server |

Example:

```bash
uv run bin/dndcs.py testdata/sample.yaml --port 9123
```

Then open [http://localhost:9123](http://localhost:9123) in your browser.

## Development

```bash
make check   # lint, type-check, format-check
make fix     # auto-format and fix lint issues
make test    # run tests
```

## Data Format

Character sheets are YAML files. See `schema/character.yaml` for the schema and `testdata/sample.yaml` for an example.

To validate a character file:

```bash
uv run check-jsonschema --schemafile schema/character.yaml <file.yaml>
```

## Software Notes

### ssh

- Type passphrase once: `ssh-add <public_key_file>`
- Test connection: `ssh -T git@github.com`

### git

#### Uncommitted Local Changes

- Modified files: `git status`
- Diff: `git diff`

#### Committed Local Changes

- Add files and directories to be committed: `git add <file/dir>`
- Commit local changes: `git commit -m "<message>"`
- See commits that haven't been uploaded yet: `git log origin/main..main`
- Diff committed & uncommitted changes vs last fetch: `git diff HEAD origin/main`

#### Remote Changes

- Check for newer changes: `git fetch`
- Get newer changes: `git pull origin main`
  > **What if there are conflicts?**
  > Conflicts happen if you and someone else (or you on another machine) changed the exact same line of the same file. Git will stop the `pull`, mark the conflicting lines in the file with `<<<<<<<`, `=======`, and `>>>>>>>`, and ask you to fix them. You'll need to edit the file, pick the correct version, then `git add` and `git commit` to finish.
- Upload committed local changes to remote repository: `git push origin main`

#### Other Useful Commands

- View history (compact list): `git log --oneline`
- Undo uncommitted changes in a file: `git checkout -- <filename>`

## TODO

* Rework campaign notes
* Make large box panel at the bottom to type text
* Support numeric syntax
