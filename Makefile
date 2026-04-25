# Makefile for dndcs project

UV := $(shell command -v uv 2> /dev/null)
PYTHON := uv run python

SRC_DIRS := bin lib

.PHONY: help setup clean check fix lint type-check format format-check test test-unit test-e2e

help:
	@echo "Available commands:"
	@echo "  setup        - Create venv, install dependencies, and install Playwright browsers"
	@echo "  clean        - Remove the virtual environment"
	@echo "  check        - Run all checks (lint, type, format)"
	@echo "  fix          - Run formatting and lint auto-fixes"
	@echo "  test         - Run all tests (unit + integration)"

ifndef UV
$(error "uv is not installed. Please install it: brew install uv")
endif

setup:
	@echo "Setting up project environment with uv..."
	uv sync --group dev
	@echo "Installing Playwright browsers..."
	uv run playwright install chromium
	@echo "Setup complete."

clean:
	@echo "Removing .venv..."
	rm -rf .venv
	@echo "Clean complete."

lint:
	@echo "Running ruff check..."
	uv run ruff check $(SRC_DIRS)

type-check:
	@echo "Running mypy..."
	uv run mypy $(SRC_DIRS)

format-check:
	@echo "Checking formatting with ruff..."
	uv run ruff format --check $(SRC_DIRS)

check: lint type-check format-check

format:
	@echo "Formatting with ruff..."
	uv run ruff format $(SRC_DIRS)

lint-fix:
	@echo "Running ruff lint fixes..."
	uv run ruff check --fix $(SRC_DIRS)

fix: format lint-fix

test-unit:
	@echo "Running JS unit tests..."
	node --test tests/unit/test_logic.mjs

test-e2e:
	@echo "Running integration tests..."
	uv run pytest tests/integration/

test: test-unit test-e2e
