-- 0049 — Purge synthetic intel-news items.
--
-- After M28, External Intelligence ran via two synthetic paths (stub
-- templates + Claude-fabricated headlines). Both produced items with
-- `source_url = NULL` because the headlines weren't real and there was
-- no actual article to link to. Now that the GDELT integration is live
-- (real headlines + real source URLs), keep only real items.
--
-- Anything with `source_url IS NULL` is by definition synthetic. Real
-- GDELT items always carry the article URL. Hidden items + items already
-- pushed-as-signal are wiped too — the signals back-link is via the
-- `intel_news_items.signal_id` column; resolving that here would require
-- a cross-update we don't want. Stakeholders can re-promote the real
-- ones after refresh.

delete from intel_news_items
 where source_url is null;
