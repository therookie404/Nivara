"""Build a one-slide competitor comparison PPTX for the NIVARA deck."""
import os
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "competitor_slide.pptx")

BG = RGBColor(0x0E, 0x1A, 0x2E)
GOLD = RGBColor(0xE8, 0xB4, 0x4A)
HEADER_BG = GOLD
HEADER_TX = RGBColor(0x0E, 0x1A, 0x2E)
ROW_A = RGBColor(0x16, 0x26, 0x3F)
ROW_B = RGBColor(0x0E, 0x1A, 0x2E)
BODY_TX = RGBColor(0xE8, 0xED, 0xF3)
MUTED = RGBColor(0x9A, 0xA7, 0xBD)

ROWS = [
    ("SuperMoney · Sense AI (US)", "Consumers",
     "AI assistant that knows your debt, rates & credit; tells you what to do next",
     "US-centric, needs linked bank accounts; no stress-trajectory forecast or recovery simulator"),
    ("PsyFi (Canada)", "Consumers",
     "Behavioral-finance coaching to reduce money stress",
     "Habit psychology, not financial prediction; no early-warning model"),
    ("AI liquidity tools\n(Float / Pulse et al.)", "Small businesses",
     "Cash-flow forecasting, what-if scenarios, shortfall alerts via Xero/QuickBooks",
     "Western SMEs, accounting-linked; no explainable risk drivers for the owner"),
    ("i-Mandate — Yes Bank + Open (IN)", "Consumers / SMEs",
     "Predicts recurring-payment failures before debit; offers alternatives",
     "Single feature (payments only); no holistic stress picture"),
    ("FinRadar — Finnable (IN)", "Lenders",
     "Early-warning system predicting borrower defaults from cash-flow patterns",
     "Built for lenders, not the borrower"),
    ("Riverline AI (IN)", "Distressed borrowers",
     "AI debt counsellors; manages \u20b9100 cr+/month in bad loans",
     "Starts after default \u2014 NIVARA prevents what they treat"),
    ("SpoctoX / CreditNirvana /\nRezolv (IN)", "Lenders",
     "AI collections & borrower-behavior prediction",
     "Collections, not prevention; lender-side"),
    ("Credit Coach (BharatPe) /\nTopScore (Yubi) (IN)", "Consumers / merchants",
     "Credit-health guidance, multilingual",
     "Education, not prediction; no forward-looking risk"),
    ("Mint / Credit Karma", "Consumers",
     "Reactive dashboards & credit scores",
     "Record the past; flag problems after they occur"),
]
HEADERS = ["Competitor", "Who it's for", "What they do", "Gap vs NIVARA"]
COL_W = [Inches(2.7), Inches(1.7), Inches(3.9), Inches(4.0)]


def set_cell(cell, text, size, bold=False, color=BODY_TX, align=PP_ALIGN.LEFT):
    cell.text = ""
    p = cell.text_frame.paragraphs[0]
    p.alignment = align
    run = p.add_run()
    run.text = text
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.color.rgb = color
    run.font.name = "Calibri"
    cell.vertical_anchor = 1  # middle


prs = Presentation()
prs.slide_width = Inches(13.333)
prs.slide_height = Inches(7.5)
slide = prs.slides.add_slide(prs.slide_layouts[6])  # blank
slide.background.fill.solid()
slide.background.fill.fore_color.rgb = BG

# title
tx = slide.shapes.add_textbox(Inches(0.5), Inches(0.25), Inches(12.3), Inches(0.6)).text_frame
tx.word_wrap = True
p = tx.paragraphs[0]
r = p.add_run(); r.text = "Competitive Landscape"
r.font.size = Pt(30); r.font.bold = True; r.font.color.rgb = GOLD; r.font.name = "Calibri"

sub = slide.shapes.add_textbox(Inches(0.5), Inches(0.85), Inches(12.3), Inches(0.4)).text_frame
sub.word_wrap = True
p = sub.paragraphs[0]
r = p.add_run()
r.text = "Everyone is reactive, lender-side, or post-crisis. Nobody owns pre-crisis early warning for the borrower."
r.font.size = Pt(14); r.font.color.rgb = MUTED; r.font.name = "Calibri"

# table
n_rows = len(ROWS) + 1
left, top = Inches(0.5), Inches(1.45)
table_shape = slide.shapes.add_table(n_rows, 4, left, top, sum(COL_W), Inches(0.55 + 0.52 * len(ROWS)))
table = table_shape.table
for i, w in enumerate(COL_W):
    table.columns[i].width = w

for j, h in enumerate(HEADERS):
    cell = table.cell(0, j)
    cell.fill.solid(); cell.fill.fore_color.rgb = HEADER_BG
    set_cell(cell, h, 11, bold=True, color=HEADER_TX)

for i, row in enumerate(ROWS, start=1):
    fill = ROW_A if i % 2 else ROW_B
    for j, val in enumerate(row):
        cell = table.cell(i, j)
        cell.fill.solid(); cell.fill.fore_color.rgb = fill
        set_cell(cell, val, 9.5, bold=(j == 0))

# footer takeaway
ft = slide.shapes.add_textbox(Inches(0.5), Inches(6.85), Inches(12.3), Inches(0.45)).text_frame
ft.word_wrap = True
p = ft.paragraphs[0]
r = p.add_run()
r.text = "NIVARA\u2019s edge: trajectory-based prediction \u00d7 SHAP explanations \u00d7 what-if recovery simulation \u2014 for India\u2019s gig & self-employed."
r.font.size = Pt(12); r.font.bold = True; r.font.color.rgb = GOLD; r.font.name = "Calibri"

prs.save(OUT)
print("saved", OUT)
