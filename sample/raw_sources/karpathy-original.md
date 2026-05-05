# Karpathy Original Template Notes

The useful system starts with raw sources, then builds a wiki that can be edited by both the user and the language model.

Raw sources are append-only evidence. They include transcripts, PDFs, notes, screenshots with OCR, email exports, and product documents. The user should be able to drop files into `raw_sources/` without thinking about where they belong.

The wiki is the real working surface. It contains source pages, concept pages, entity pages, synthesis pages, and relationship summaries. The value is not only file organization. The value is creating useful nodes and links between ideas so a language model can navigate the user's context.

Every generated page should make uncertainty visible. Draft pages need status, source links, and edit proposals instead of silent overwrites.

The operating layer should include Markdown files that teach Claude, ChatGPT, or another language model how to inspect the vault, create pages, add links, propose edits, and avoid inventing unsupported claims.
