-- Migration: add_screenshots_to_trades
-- Version:   20260514204752
-- Applied:   2026-05-14
--
-- Adds two optional screenshot URL columns to the trades table.
-- Used by the trade journal UI to attach chart images to each trade.

ALTER TABLE public.trades
  ADD COLUMN IF NOT EXISTS screenshot_1_url text,
  ADD COLUMN IF NOT EXISTS screenshot_2_url text;
