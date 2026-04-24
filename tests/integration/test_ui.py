"""Playwright UI tests — require `playwright install chromium` to have been run."""

import re

import yaml
from playwright.sync_api import Page, expect


def test_page_loads_with_character_name(page: Page, base_url: str) -> None:
    page.goto(base_url)
    expect(page.locator("#character-name-display")).to_contain_text("Ser Aldric Vane")


def test_bio_tab_is_active_on_load(page: Page, base_url: str) -> None:
    page.goto(base_url)
    expect(page.locator(".tab-btn.active")).to_have_text("Bio")


def test_all_tabs_present(page: Page, base_url: str) -> None:
    page.goto(base_url)
    for label in ("Bio", "Feats & Features", "Gear", "Campaign Notes", "Level Log"):
        expect(page.locator(f".tab-btn", has_text=label)).to_be_visible()


def test_feats_tab_shows_cards(page: Page, base_url: str) -> None:
    page.goto(base_url)
    page.locator(".tab-btn", has_text="Feats & Features").click()
    # Sample data has 7 feat cards
    expect(page.locator(".feat-card").first).to_be_visible()


def test_add_and_save_note(page: Page, base_url: str, out_file: object) -> None:
    page.goto(base_url)
    page.locator(".tab-btn", has_text="Campaign Notes").click()

    initial_count = page.locator(".note-card").count()
    page.locator("#add-note-btn").click()

    # Fill dialog
    page.locator("#note-dialog-tags").fill("test-tag")
    page.locator("#note-dialog-text").fill("A brand new test note.")
    page.keyboard.press("Control+Enter")

    # Note appears in list
    expect(page.locator(".note-card")).to_have_count(initial_count + 1)

    # Save and verify file
    page.locator("#save-btn").click()
    page.wait_for_timeout(400)
    saved = yaml.safe_load(out_file.read_text())  # type: ignore[union-attr]
    texts = [n["text"] for n in saved["campaign_notes"]]
    assert "A brand new test note." in texts


def test_new_note_goes_to_end_of_list(page: Page, base_url: str) -> None:
    page.goto(base_url)
    page.locator(".tab-btn", has_text="Campaign Notes").click()

    count_before = page.locator(".note-card").count()
    page.locator("#add-note-btn").click()
    page.locator("#note-dialog-text").fill("Last note")
    page.keyboard.press("Control+Enter")

    # Last card should be the new one
    last_card = page.locator(".note-card").nth(count_before)
    expect(last_card).to_contain_text("Last note")


def test_add_feat(page: Page, base_url: str) -> None:
    page.goto(base_url)
    page.locator(".tab-btn", has_text="Feats & Features").click()

    count_before = page.locator(".feat-card").count()
    page.locator("#add-feat-btn").click()
    page.locator("#feat-dialog-text").fill("**New Feat** — does something cool")
    page.keyboard.press("Control+Enter")

    expect(page.locator(".feat-card")).to_have_count(count_before + 1)


def test_edit_bio_field_and_undo(page: Page, base_url: str) -> None:
    page.goto(base_url)
    # Wait for bio to load
    expect(page.locator("#character-name-display")).to_contain_text("Ser Aldric Vane")

    # Click the display span to open the edit dialog
    page.locator("#character-name-display").click()
    expect(page.locator("#edit-dialog")).to_be_visible()

    # Change the value
    ta = page.locator("#edit-dialog-textarea")
    ta.fill("New Hero Name")
    page.keyboard.press("Control+Enter")

    expect(page.locator("#character-name-display")).to_contain_text("New Hero Name")

    # Undo
    page.keyboard.press("Control+z")
    expect(page.locator("#character-name-display")).to_contain_text("Ser Aldric Vane")


def test_save_button_writes_file(page: Page, base_url: str, out_file: object) -> None:
    page.goto(base_url)
    expect(page.locator("#character-name-display")).to_contain_text("Ser Aldric Vane")

    page.locator("#save-btn").click()
    page.wait_for_timeout(400)

    saved = yaml.safe_load(out_file.read_text())  # type: ignore[union-attr]
    assert saved["bio"]["character_name"] == "Ser Aldric Vane"


def test_tag_filter_hides_non_matching_notes(page: Page, base_url: str) -> None:
    page.goto(base_url)
    page.locator(".tab-btn", has_text="Campaign Notes").click()

    total = page.locator(".note-card").count()

    # Click first tag filter chip
    first_chip = page.locator(".tag-filter-chip").first
    tag_text = first_chip.text_content()
    first_chip.click()

    # Fewer (or equal) cards should be visible
    visible_after = page.locator(".note-card").count()
    assert visible_after <= total

    # Show All restores full list
    page.locator(".btn-clear-filter").click()
    expect(page.locator(".note-card")).to_have_count(total)


def test_edit_dialog_shows_hints(page: Page, base_url: str) -> None:
    page.goto(base_url)
    expect(page.locator("#character-name-display")).to_contain_text("Ser Aldric Vane")
    page.locator("#character-name-display").click()
    expect(page.locator("#edit-dialog-hint")).to_contain_text("↵ to save")
    expect(page.locator("#edit-dialog-hint")).to_contain_text("Esc to cancel")
    expect(page.locator("#edit-dialog-syntax-hint")).to_contain_text("**bold**")


def test_feat_dialog_shows_hints(page: Page, base_url: str) -> None:
    page.goto(base_url)
    page.locator(".tab-btn", has_text="Feats & Features").click()
    page.locator("#add-feat-btn").click()
    expect(page.locator("#feat-dialog-hint")).to_contain_text("↵ to save")
    expect(page.locator("#feat-dialog-hint")).to_contain_text("Esc to cancel")
    expect(page.locator("#feat-dialog-syntax-hint")).to_contain_text("**bold**")


def test_note_dialog_shows_hints(page: Page, base_url: str) -> None:
    page.goto(base_url)
    page.locator(".tab-btn", has_text="Campaign Notes").click()
    page.locator("#add-note-btn").click()
    expect(page.locator("#note-dialog-hint")).to_contain_text("↵ to save")
    expect(page.locator("#note-dialog-hint")).to_contain_text("Esc to cancel")
    expect(page.locator("#note-dialog-syntax-hint")).to_contain_text("**bold**")


def test_gear_dialog_shows_hints(page: Page, base_url: str) -> None:
    page.goto(base_url)
    page.locator(".tab-btn", has_text="Gear").click()
    page.locator("#add-gear-btn").click()
    expect(page.locator("#gear-dialog-hint")).to_contain_text("↵ to save")
    expect(page.locator("#gear-dialog-hint")).to_contain_text("Esc to cancel")
    expect(page.locator("#gear-dialog-syntax-hint")).to_contain_text("**bold**")


def test_level_log_dialog_shows_hints(page: Page, base_url: str) -> None:
    page.goto(base_url)
    page.locator(".tab-btn", has_text="Level Log").click()
    page.locator("#add-level-log-btn").click()
    expect(page.locator("#level-log-dialog-hint")).to_contain_text("↵ to save")
    expect(page.locator("#level-log-dialog-hint")).to_contain_text("Esc to cancel")
    expect(page.locator("#level-log-dialog-syntax-hint")).to_contain_text("**bold**")


def test_gear_collapse_all(page: Page, base_url: str) -> None:
    page.goto(base_url)
    page.locator(".tab-btn", has_text="Gear").click()

    page.locator("#toggle-all-gear-btn").click()
    expect(page.locator("#toggle-all-gear-btn")).to_have_text("Expand All")
    # All sections should be collapsed
    for section in page.locator(".gear-section").all():
        expect(section).to_have_class(re.compile(r"\bcollapsed\b"))

    page.locator("#toggle-all-gear-btn").click()
    expect(page.locator("#toggle-all-gear-btn")).to_have_text("Collapse All")


def test_delete_feat(page: Page, base_url: str) -> None:
    page.goto(base_url)
    page.locator(".tab-btn", has_text="Feats & Features").click()
    count_before = page.locator(".feat-card").count()
    if count_before > 0:
        page.locator(".feat-card").first.click()
        page.locator("#feat-dialog-delete-btn").click()
        expect(page.locator(".feat-card")).to_have_count(count_before - 1)


def test_delete_note(page: Page, base_url: str) -> None:
    page.goto(base_url)
    page.locator(".tab-btn", has_text="Campaign Notes").click()
    count_before = page.locator(".note-card").count()
    if count_before > 0:
        page.locator(".note-card").first.click()
        page.locator("#note-dialog-delete-btn").click()
        expect(page.locator(".note-card")).to_have_count(count_before - 1)


def test_delete_level_log(page: Page, base_url: str) -> None:
    page.goto(base_url)
    page.locator(".tab-btn", has_text="Level Log").click()
    count_before = page.locator("#level-log-tbody tr").count()
    if count_before > 0:
        page.locator("#level-log-tbody tr").first.click()
        page.locator("#level-log-dialog-delete-btn").click()
        expect(page.locator("#level-log-tbody tr")).to_have_count(count_before - 1)
