#!/usr/bin/python3
"""Draw assets/banner.svg for the README: the Obsidian logo (from Iconify),
the name and what AgendaPlus does, in the Obsidian palette.

Text is turned into outlines (Pango lays them out, cairo writes paths), so the
banner looks the same on every computer without the fonts installed.
Needs: the Poppins font, PyGObject with Pango and Rsvg.
Run: assets/make-banner.py"""

import os

import cairo
import gi

gi.require_version("Pango", "1.0")
gi.require_version("PangoCairo", "1.0")
gi.require_version("Rsvg", "2.0")
from gi.repository import Pango, PangoCairo, Rsvg  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
W, H, RADIUS = 1280, 340, 28
LOGO = os.path.join(HERE, "logo-obsidian.svg")
OUT = os.path.join(HERE, "banner.svg")


def hex_rgb(value):
    return tuple(int(value[i:i + 2], 16) / 255 for i in (1, 3, 5))


# The Obsidian palette. MUTED is Text at 62% on Ink.
INK = hex_rgb("#17151f")
PURPLE = hex_rgb("#7c3aed")
LAVENDER = hex_rgb("#a882ff")
TEXT = hex_rgb("#f0edf7")
MUTED = tuple(c * 0.62 + i * 0.38 for c, i in zip(TEXT, INK))
TILE = tuple(c * 0.10 + i * 0.90 for c, i in zip(PURPLE, INK))  # ink, 10% toward purple


def rounded_rect(cr, x, y, w, h, r):
    cr.new_sub_path()
    cr.arc(x + w - r, y + r, r, -1.5708, 0)
    cr.arc(x + w - r, y + h - r, r, 0, 1.5708)
    cr.arc(x + r, y + h - r, r, 1.5708, 3.1416)
    cr.arc(x + r, y + r, r, 3.1416, 4.7124)
    cr.close_path()


def text(cr, x, y, value, font, rgb):
    layout = PangoCairo.create_layout(cr)
    layout.set_font_description(Pango.FontDescription.from_string(font))
    layout.set_text(value, -1)
    cr.move_to(x, y)
    cr.set_source_rgb(*rgb)
    PangoCairo.layout_path(cr, layout)  # outlines, not <text>
    cr.fill()
    _ink, logical = layout.get_pixel_extents()
    return logical.width, logical.height


# --- feature icons, drawn in a 20 x 20 box at (x, y)

def _icon_views(cr, x, y):
    # a calendar page with a marked day
    rounded_rect(cr, x + 1.5, y + 3, 17, 15.5, 2.5)
    cr.stroke()
    cr.move_to(x + 1.5, y + 7.5)
    cr.line_to(x + 18.5, y + 7.5)
    cr.stroke()
    rounded_rect(cr, x + 11, y + 10.5, 5, 5, 1)
    cr.fill()


def _icon_drag(cr, x, y):
    # a task chip moved onto another day
    rounded_rect(cr, x + 1, y + 1.5, 8.5, 6.5, 1.5)
    cr.stroke()
    rounded_rect(cr, x + 10, y + 11.5, 9.5, 7, 1.5)
    cr.stroke()
    cr.move_to(x + 5.5, y + 8)
    cr.line_to(x + 10.5, y + 10.7)
    cr.stroke()
    cr.move_to(x + 13.5, y + 13)
    cr.line_to(x + 9.7, y + 13.4)
    cr.line_to(x + 13.3, y + 9.7)
    cr.close_path()
    cr.fill()


def _icon_repeat(cr, x, y):
    # two arrows chasing each other
    cr.arc(x + 10, y + 10, 7.5, -0.5, 2.2)
    cr.stroke()
    cr.arc(x + 10, y + 10, 7.5, 2.7, 5.4)
    cr.stroke()
    cr.move_to(x + 16.4, y + 4.6)
    cr.line_to(x + 13.2, y + 6.4)
    cr.line_to(x + 16.6, y + 8.9)
    cr.stroke()
    cr.move_to(x + 3.6, y + 15.4)
    cr.line_to(x + 6.8, y + 13.6)
    cr.line_to(x + 3.4, y + 11.1)
    cr.stroke()


def _icon_countdown(cr, x, y):
    # a clock face
    cr.arc(x + 10, y + 10, 8.5, 0, 6.2832)
    cr.stroke()
    cr.move_to(x + 10, y + 10)
    cr.line_to(x + 10, y + 5)
    cr.move_to(x + 10, y + 10)
    cr.line_to(x + 14, y + 12)
    cr.stroke()


def _icon_tags(cr, x, y):
    # a tag
    cr.move_to(x + 1.5, y + 9.2)
    cr.line_to(x + 8.8, y + 1.8)
    cr.arc(x + 10.1, y + 3.1, 1.85, 2.3562, 3.9270)
    cr.line_to(x + 17.4, y + 10.4)
    cr.line_to(x + 10.6, y + 17.5)
    cr.line_to(x + 2.8, y + 17.5)
    cr.close_path()
    cr.stroke()
    cr.arc(x + 13.1, y + 6.4, 1.5, 0, 6.2832)
    cr.fill()


def _icon_stats(cr, x, y):
    # three bars, the last one done
    cr.move_to(x + 2.5, y + 17)
    cr.line_to(x + 17.5, y + 17)
    cr.stroke()
    rounded_rect(cr, x + 2.5, y + 9.5, 3.6, 7.5, 1)
    cr.fill()
    rounded_rect(cr, x + 8.2, y + 5, 3.6, 12, 1)
    cr.fill()
    rounded_rect(cr, x + 13.9, y + 12, 3.6, 5, 1)
    cr.fill()


FEATURES = [
    [("Month · Week · Day views", _icon_views), ("Drag & drop rescheduling", _icon_drag),
     ("Recurring tasks", _icon_repeat)],
    [("Event countdowns", _icon_countdown), ("Priority tags & filters", _icon_tags),
     ("Completion stats", _icon_stats)],
]


def feature(cr, x, y, label, icon):
    """An icon in the accent colour and its label; returns the width used."""
    cr.set_source_rgb(*PURPLE)
    cr.set_line_width(1.8)
    cr.set_line_cap(cairo.LINE_CAP_ROUND)
    cr.set_line_join(cairo.LINE_JOIN_ROUND)
    icon(cr, x, y + 3)
    layout = PangoCairo.create_layout(cr)
    layout.set_font_description(Pango.FontDescription.from_string("Poppins 19px"))
    layout.set_text(label, -1)
    _ink, logical = layout.get_pixel_extents()
    cr.move_to(x + 30, y + 13 - logical.height / 2)
    cr.set_source_rgb(*TEXT)
    PangoCairo.layout_path(cr, layout)
    cr.fill()
    return 30 + logical.width


def main():
    surface = cairo.SVGSurface(OUT, W, H)
    surface.set_document_unit(cairo.SVGUnit.PX)
    cr = cairo.Context(surface)

    rounded_rect(cr, 0, 0, W, H, RADIUS)
    cr.set_source_rgb(*INK)
    cr.fill_preserve()
    cr.clip()

    # the Obsidian logo (Iconify) on a quiet tile
    cy = H / 2
    rounded_rect(cr, 55, cy - 130, 260, 260, 40)
    cr.set_source_rgb(*TILE)
    cr.fill_preserve()
    cr.set_source_rgba(PURPLE[0], PURPLE[1], PURPLE[2], 0.55)
    cr.set_line_width(3)
    cr.stroke()
    logo = Rsvg.Handle.new_from_file(LOGO)
    viewport = Rsvg.Rectangle()
    # 4 px up-right of dead centre: the crystal's mass sits low-left, so this
    # reads as optically centred
    viewport.x, viewport.y, viewport.width, viewport.height = 104, cy - 81, 170, 170
    logo.render_document(cr, viewport)

    # name, with "Plus" in the light accent, and tagline
    x = 372
    width, _ = text(cr, x, 30, "Agenda", "Poppins SemiBold 76px", TEXT)
    text(cr, x + width, 30, "Plus", "Poppins SemiBold 76px", LAVENDER)
    text(cr, x + 4, 140, "Tasks, events and stats on one calendar, inside Obsidian.",
         "Poppins 25px", MUTED)

    # what it does: two quiet rows, no boxes
    y = 204
    for row in FEATURES:
        cx = x + 4
        for label, icon in row:
            cx += feature(cr, cx, y, label, icon) + 34
        y += 46

    surface.finish()
    print(OUT)


if __name__ == "__main__":
    main()
