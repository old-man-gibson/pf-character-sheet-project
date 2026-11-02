"""Write the invented workbook that tests/convert.test.mjs converts.

The test converts a workbook with app/js/convert.js and compares the result
with what tools/convert.py wrote for it. The players' workbooks are not in the
repository, so this writes one that is, for an invented character. Every tab,
label and cell sits where an extractor looks for it, and each extractor has a
row or two to read: text with punctuation, numbers typed as text, booleans,
dates, blanks inside tables, a hidden tab and one tab no extractor knows. The
numbers are not a consistent build.

It also carries the inputs the two converters once read differently: a TRUE
in the point-buy table, a name holding a formula, a tab name with an
apostrophe, text with a byte-order mark or a next-line at its edge,
full-width digits, numbers too small or too large for plain digits, a time of
day, lengths of time, and ISO dates.

openpyxl writes every string inline and no cached formula values, which a
Google Sheets export never does. So save() rewrites a few things in the file
it wrote: two tabs keep their text in the shared-string table, some cells
become raw XML (ISO dates, formulas with their last values, rich text), and
two parts are stored rather than compressed.

The bytes are reproducible: the document properties and ZIP entry times are
pinned, so a re-run writes the same file.

Usage: python tools/make-public-workbook.py
Then:  python tools/convert.py tests/fixtures/workbook/raw/marnie.xlsx --id marnie
           --name "Marnie Tallow (test workbook)" --out tests/fixtures/workbook/characters
"""

import datetime
import io
import os
import re
import zipfile

import openpyxl
from openpyxl.utils.cell import (column_index_from_string, coordinate_from_string,
                                 get_column_letter)
from openpyxl.workbook.defined_name import DefinedName
from openpyxl.writer.excel import ExcelWriter

ID = "marnie"
OUT = os.path.join("tests", "fixtures", "workbook", "raw", f"{ID}.xlsx")

# openpyxl stamps the time into the document properties and every ZIP entry.
PINNED = datetime.datetime(2026, 1, 1)
ZIP_TIME = (2026, 1, 1, 0, 0, 0)


def cells(ws, values):
    """Write {"A1": value, ...}; None leaves the cell blank."""
    for ref, value in values.items():
        if value is not None:
            ws[ref] = value


def row(ws, start, values):
    """Write values rightwards from `start`; None leaves a cell blank."""
    col, r = coordinate_from_string(start)
    c = column_index_from_string(col)
    for i, value in enumerate(values):
        if value is not None:
            ws.cell(row=r, column=c + i, value=value)


def character_info(ws):
    # Identity, read from fixed cells.
    cells(ws, {
        "B3": "Name", "C3": "Marnie Tallow", "H3": "Player", "I3": "Jordan Vale",
        "C4": "Half-Elf", "F4": "Medium", "I4": "Female", "K4": 34,
        "R4": "https://example.com/portraits/marnie.png",
        "C5": "Wayfarer", "E5": "+2", "I5": "5' 7\"", "K5": "130 lb.",
        # The level in a full-width digit, as a Japanese keyboard types it.
        "B6": "Level", "C6": "\uff17", "F6": "Neutral Good",
        # A 0 where the specialty feat goes, as a lookup leaves it: the feat
        # beside it is the one read.
        "C7": "Scholar", "F7": 0, "H7": "Skill Focus (Knowledge: arcana)",
        "C8": "Quick Study",
        "C10": "Common, Elven", "H10": "Sylvan", "C11": "Draconic; Gnome",
        "O11": "Simple, Martial", "O12": "Light",
        "N16": "Ember Step", "Q15": "Lantern Society",
    })
    # Speeds: type, base, bonus, final. Row 6 is left empty.
    row(ws, "M4", ["Land", 30, 0, 30])
    row(ws, "M5", ["Climb", 15, 5, 20])
    row(ws, "M7", ["Swim", "10 ft.", "\uff0d\uff12\uff0e\uff15", 10])   # full-width -2.5

    # Abilities: score, mod, temp score, total mod, check mod.
    for i, values in enumerate([
        ["Str", 12, 1, 12, 1, 1],
        ["Dex", 14, 2, 16, 3, 3],
        ["Con", 13, 1, 13, 1, 1],
        ["Int", 18, 4, 18, 4, 4],
        ["Wis", 10, 0, None, 0, "—"],
        ["Cha", 8, -1, 8, -1, -1],
    ]):
        row(ws, f"B{15 + i}", values)
    row(ws, "I15", [6, "Dex", "Wis"])                 # initiative

    # Hit points, and the mythic block beside them.
    cells(ws, {
        "J18": 52, "L18": "Con", "J19": 7, "J20": 0, "L20": "3",
        "M18": "Path", "N18": "Archmage", "M19": "Tier", "N19": 2,
        "M20": "Focus", "N20": "Int",
    })

    # The wallet, with one label merged across the blank its value skips.
    cells(ws, {
        "R18": "Wallet (Baseline after OoO)", "R19": 1250,
        "T18": "Current Mana", "V18": 1310,
        "T19": "Oath of Offerings", "U19": True,
        "T20": "Material Casting", "U20": False,
        "T21": "Last Offering", "U21": datetime.datetime(2026, 10, 3, 18, 30),
        "T22": "Mana/Day", "U22": 12.5,
        "T23": "Sessions", "U23": 6,
    })
    ws.merge_cells("T18:U18")

    # Classes: name, -, HD, BAB, BAB override, Fort, Ref, Will, ranks, archetypes.
    row(ws, "B22", ["Class", None, "HD", "BAB", "Override", "Fort", "Ref", "Will",
                    "Skill Ranks", "Archetypes"])
    row(ws, "B23", ["Wizard", None, 6, 0.5, None, False, False, True, 2, "Hedge Scholar"])
    row(ws, "B24", ["Class 2"])                          # the template's placeholder
    row(ws, "B25", ["Rogue", None, 8, 0.75, "3", 0, 1, 0, "8 + Int", "Scout; Sapper"])

    # Defences.
    cells(ws, {
        "B44": "AC", "C44": 17, "E44": "Dex", "I44": True,
        "B45": "Touch", "C45": 12, "H45": 0,
        "B46": "Flat-Footed", "C46": 15, "E46": "Int", "H46": 1,
        "B47": "CMD", "C47": 16, "E47": 14,
        "E48": "5/cold iron", "E49": "Sleep; paralysis", "E50": "Fire 5, cold 5",
    })

    # Conditions: only Helpless and Paralyzed on, which the converters clear.
    row(ws, "K44", ["Blinded", 0, "Dazzled", False])
    row(ws, "K45", ["Helpless", 1, "Paralyzed", True])
    row(ws, "K46", ["Fatigued", None, "Shaken", "0"])
    row(ws, "K47", ["Sickened", 0])

    # Carrying capacity.
    row(ws, "V44", ["Light", None, 76])
    row(ws, "V45", ["Medium", None, 153])
    row(ws, "V46", ["Heavy", None, 230])
    row(ws, "V48", ["Push or Drag", None, "1,150 lb."])
    row(ws, "V50", ["Str Bonus", 2])
    row(ws, "V51", ["Quadruped", False])
    row(ws, "V52", ["Carried", 41.5])

    # Attack: value, stat 1, stat 2, and the totals in column I.
    row(ws, "B52", ["BAB", 3, None, "+3"])
    for r, values in [
        (53, ["Melee", 4, None, "Str"]),
        (54, ["Alt Melee", 5, None, "Dex", None, None, None, 5]),
        (55, ["Ranged", 5, None, "Dex"]),
        (56, ["Alt Ranged", 4, None, "Str", None, None, None, 5]),
        (57, ["CMB", 4, None, "Str"]),
        (58, ["Alt CMB", 5, None, "Dex", None, "Int", None, 5]),
    ]:
        row(ws, f"B{r}", values)

    # Saves: total, stat 1, stat 2, base.
    row(ws, "B61", ["Fort", 4, None, "Con", None, None, None, None, 2])
    row(ws, "B62", ["Ref", 7, None, "Dex", None, None, None, None, 5])
    row(ws, "B63", ["Will", 6, None, "Wis", None, "Int", None, None, 5])

    # Traits: slot, category, -, text. Trait 3 is empty and is skipped.
    row(ws, "K60", ["Trait 1", "Magic", None, "Magical Lineage: one spell counts a level lower."])
    row(ws, "K61", ["Trait 2", "Social"])
    row(ws, "K62", ["Trait 3"])
    row(ws, "K63", ["Drawback", "Drawback", None, "Doubt (−2 on checks after a failure)"])
    cells(ws, {"L64": "No slot"})
    cells(ws, {"B65": "Race Traits", "C66": "Elf Blood", "C67": "Keen Senses: +2 Perception",
               "C69": "Adaptability", "C72": 0})

    # Resource tracker: label, header row, then name, uses, total, refresh.
    cells(ws, {"V60": "Resource Tracker"})
    row(ws, "V61", ["Name", "Uses", "Total", "Refresh"])
    row(ws, "V62", ["Arcane Bond", 0, 1, "Day"])
    row(ws, "V63", ["Wand of Light", "12", 50])
    row(ws, "V65", ["Hand of the Apprentice", 2, "3 + Int", "Day"])

    # Skills: name, spec, bonus, class skill, total ranks, ranks by source
    # (G-N), trained only, armour penalty, abilities (Q-S), notes.
    row(ws, "B76", ["Skills", None, "Bonus", "Class", "Ranks"])
    row(ws, "G77", ["Level", "Specialty", "Gear", "Other", None, "Mythic", "Background",
                    "Racial", "Trained", "ACP", "Ability", None, None, "Notes"])
    row(ws, "B78", ["Acrobatics", None, 5, False, 1, 1, None, None, None, None, None, None,
                    None, "No", True, "Dex"])
    row(ws, "B79", ["Knowledge", "Arcana", 12, True, 7, 6, 1, None, None, None, None, None,
                    None, "Yes", False, "Int", None, None, "+2 vs. constructs"])
    row(ws, "B80", ["Craft", "Alchemy", 4, 1, 0, None, None, None, None, None, None, None,
                    None, "yes", None, "Int"])
    row(ws, "B81", ["Perception", None, "+9", True, "7", 6, None, "1", None, 3, None, None,
                    None, None, None, "Wis"])
    row(ws, "B83", ["Skills"])                           # a repeated heading
    row(ws, "B84", ["Stealth", None, 2.5, None, 0, "x", None, None, None, None, None, None,
                    None, None, True, "Dex", "Cha"])
    row(ws, "B85", ["Use Magic Device", None, -1, "yes", 0, None, None, None, None, None, None,
                    None, None, "YES", None, "Cha", None, None, "Can't take 10"])
    row(ws, "B86", ["Bonus Skill points per Level", 1])
    row(ws, "B87", ["Int Bonus per Level", 4])
    row(ws, "B88", ["Total Skill Points per Level", 13])

    ws.print_area = "A1:X90"


def stats(ws):
    row(ws, "B2", ["Total", "Point Buy", "Race", "ABP", "Gear", "Attunement", "Inherent",
                   "Array", "Level", "Mythic", "Size", "Untyped", None, "Alchemical",
                   "Circumstance", "Morale", "Temp Enhancement", "Temp Size"])
    for r, values in [
        (3, ["Str", 12, 10, None, 2, None, False, None, None, None, None, None, None, None,
             None, None, 2]),
        (4, ["Dex", 14, 12, 2, None, None, True, None, None, None, None, None, None, None,
             None, None, None, 2]),
        (5, ["Con", 13, 13, None, None, None, None, None, None, None, None, None, None,
             "pending"]),
        (6, ["Int", 18, 15, 2, None, "+0", None, None, None, 1]),
        (7, ["Wis", 10, 10]),
        (8, ["Cha", "8", 7, None, None, None, None, None, None, None, None, None, 1]),
    ]:
        row(ws, f"A{r}", values)
    # A name local to this tab, which neither converter reads.
    ws.defined_names["LocalTotal"] = DefinedName("LocalTotal", attr_text="Stats!$B$3")


def planner(ws):
    row(ws, "A1", ["Level", "Level/4", "Class 1 HD", "Class 1 Features", "Class 2 HD",
                   "Class 2 Features", "HP/ Level", "BAB", "Feats",
                   "Armored Discipline Technique", 3])
    row(ws, "AL1", ["Mental Prowess", "Physical Prowess", "Array (Optional)"])
    levels = [
        [1, None, "Wizard", "Arcane bond; cantrips", "Rogue", "Sneak attack +1d6", 6, 0,
         "Spell Focus"],
        [2, None, "Wizard", None, "Rogue", "Evasion", 4, None, None, "Ember Step"],
        [3, None, "Wizard", None, "Rogue", None, 4, 1, "Combat Casting"],
        [4, "Int", "Wizard", None, "Rogue", None, 4, 2],
        [5, None, "Wizard", "Bonus feat", "Rogue", None, "4", 2],
        [6, None, "Wizard", None, "Rogue", None, 4, 3],
        [7, None, "Wizard", None, "Rogue", None, 4, 3, "Extend Spell", None, True],
    ]
    for i, values in enumerate(levels):
        row(ws, f"A{2 + i}", values)
    row(ws, "AN2", ["Str", "Dex", None, "Int"])         # array slots at 1st
    cells(ws, {"AL7": "Int", "AM8": "Dex", "AO10": "Con", "A22": "past the last level"})


def feats(ws):
    cells(ws, {"A1": "Feats"})
    row(ws, "A2", ["Combat Feats", None, None, "General Feats", None, None, "Combat Feats",
                   None, None, "Metamagic"])
    row(ws, "A3", ["Name", None, "Notes", "Name", None, "Notes", "Name", None, "Notes"])
    row(ws, "A4", ["Dodge", None, "+1 dodge to AC", "Toughness", None, "+3 HP",
                   "Precise Shot", None, "No −4 for firing into melee"])
    row(ws, "A5", ["Point-Blank Shot", None, None, 42])
    row(ws, "D6", ["Skill Focus (Knowledge: arcana)", None, True])
    row(ws, "A7", ["Weapon Focus (light crossbow)", None, 1])
    cells(ws, {"A24": "Last row read", "A25": "Past the last row"})


def mythic(ws):
    cells(ws, {
        "B2": "Mythic Path", "C2": "Archmage", "B3": "Mythic Tier", "C3": 2,
        "C6": "Base Mythic Abilities", "C7": "Hard to Kill", "C8": "Mythic Power",
        "C9": "Base Path Ability", "D9": "Arcane Surge",
    })
    row(ws, "B11", ["Lvl", "Slot", "Ability", "Path", "Feat", "Feat Choice", "Stat Bonus"])
    row(ws, "B12", [1, "Path 1", "Wild Arcana", "Archmage"])
    row(ws, "B13", ["2", "Feat 1", None, None, "Mythic Spell Focus", "Evocation"])
    row(ws, "B14", [None, "Path 2"])
    row(ws, "B15", [None, "Stat", None, None, None, None, "Int +2"])
    row(ws, "C17", ["Mythic Tradition", None, None, True])
    for r, values in [
        (18, ["Drawback 1", "Brittle Bones"]),
        (19, ["Boon 1", "Steady Hand"]),
        (20, ["Quality", "Stoic"]),
        (21, ["Drawback 2"]),
        (22, ["Margin note", "not a tradition line"]),
    ]:
        row(ws, f"C{r}", values)


GEAR_SLOTS = ["Head", "Headband", "Eyes", "Shoulders", "Neck", "Chest", "Body",
              "Armor", "Belt", "Wrists", "Hands", "Ring 1", "Ring 2", "Feet"]


def equipment(ws):
    row(ws, "A1", ["Slot", "Item", "Bonus", "Type", "Bonus", "Type", "Bonus", "Type",
                   "Other", None, "Other", None, "Other", None, "Other", None,
                   "Weight", "Cost"])
    for i, slot in enumerate(GEAR_SLOTS):
        cells(ws, {f"A{2 + i}": slot})
    # Slotted gear: name, three value/type pairs, four others, weight, cost.
    row(ws, "B2", ["Circlet of Focus", 2, "Competence", None, "Insight", None, None,
                   "Perception +2", None, 3, None, True, None, 2.5, None, 1, "1,500 gp"])
    row(ws, "B4", ["Lenses of Detection", "+1", 5])
    # Numbers in text fields that Python's str() spells with an exponent.
    cells(ws, {"R4": 3500, "I4": 0.00005, "K4": 1e21})
    row(ws, "B13", ["Ring of Protection +1", 1, "Deflection"])
    cells(ws, {"R13": 2000})
    # Other items.
    row(ws, "B17", ["Bag of Holding (Type I)"])
    cells(ws, {"Q17": 15, "R17": 2500})
    row(ws, "B18", ["Rope, silk (50 ft.)"])
    cells(ws, {"Q18": 5, "R18": 10})
    row(ws, "B20", ["Scroll case & 3 scrolls", None, None, None, None, None, None,
                    "Spell list in notes"])

    # Armour and shields under their header row.
    row(ws, "A26", ["Armor", "Name", "Armor Value", "Max Dex", "ACP", "Type", "Ghost Touch",
                    "Spell Failure", "Other"])
    cells(ws, {"Q26": "Weight", "R26": "Cost"})
    row(ws, "A27", ["Armor", "Mithral Shirt", 4, 6, 0, "Light", False, "10%", "Silent",
                    None, None, None, 0, None, "Comfortable", None, 10, 1100])
    ws["R27"].number_format = '#,##0 "gp"'
    row(ws, "A28", ["Shield 1", "Buckler", 1, None, -1, "Shield", 1, "5%"])
    cells(ws, {"Q28": 5, "R28": 15})
    row(ws, "A29", ["Shield 2"])
    row(ws, "A30", ["Weapons"])

    # Weapon 1, in the template's own columns.
    row(ws, "A32", ["Weapon Name 1", None, "Attack type", "Attack Roll", "Damage Dice",
                    "Damage Ability", "Ability Mult", "Misc Damage", "Total Damage",
                    "Critical", None, "Bonus Crit Damage", "Damage Type"])
    row(ws, "A33", ["Longsword, +1 (cold iron)", None, "Melee", "+6/+1", "1d8", "Str", 1.5,
                    1, "1d8+3", 19, "x2", None, "S"])
    row(ws, "A34", ["Weapon Group 1", "Weapon Group 2", "Weapon Group 3", "Misc Attack",
                    "Special Properties", None, None, None, "Ammunition", "Size", None,
                    None, "Range"])
    row(ws, "A35", ["Heavy Blades", None, None, 1, "Cold iron; sheds light", None, None,
                    None, None, "Medium"])
    row(ws, "A36", ["Enhancement", 1, "Weapon Familiarity", "Martial", "Handedness",
                    "One-Handed", "Weight", 4, "Price", "2,315"])

    # Weapon 2, with an extra damage column that moves the fields after it.
    row(ws, "A38", ["Weapon Name 2", None, "Attack type", "Attack Roll", "Damage Dice",
                    "Damage Ability", "Ability Mult", "Misc Damage", "Misc Non-Crit Damage",
                    "Total Damage", "Critical Range", "Critical Multiplier",
                    "Bonus Crit Damage", "Damage Type"])
    row(ws, "A39", ["Light Crossbow", None, "Ranged", 5, "1d8", None, 0, 0, 2, "1d8",
                    "19-20", "x2", "1d6", "P"])
    row(ws, "A40", ["Weapon Group 1", "Weapon Group 2", "Weapon Group 3", "Misc Attack",
                    "Special Properties", None, None, None, "Ammunition", "Size", None,
                    "Range", "Ammunition"])
    row(ws, "A41", ["Crossbows", "Thrown", None, None, "Loading: move action", None, None,
                    None, "Bolts x20", "Small", None, "80 ft.", "Bolts (cold iron) x5"])
    row(ws, "A42", ["Enhancement", None, "Weapon Familiarity", "Simple", "Handedness",
                    "Two-Handed", "Weight", 4, "Price", 35])

    # An empty block, and one with dice but no name or labels.
    row(ws, "A44", ["Weapon Name 3"])
    row(ws, "A50", ["Weapon Name 4"])
    row(ws, "C51", ["Melee", None, "1d4"])


def background(ws):
    cells(ws, {
        "A1": "Background & Lore",
        # A byte-order mark before one line and a next-line after another,
        # which both converters trim.
        "B2": "Personality", "B3": "Curious, patient & dry-witted.",
        "B5": "\ufeffCollects \"lost\" maps.",
        "F2": "Appearance", "F3": "Ink-stained fingers; a green scarf.\x85",
        "H2": "Notes", "H3": "not a section",
        "J2": "Ez'atian Certifications", "J3": "Cartography (journeyman)",
        "B12": "Goals", "B13": 42, "B14": True,
        "F12": "Fears",
        "B22": "Additional Information", "B23": "First line.\nSecond line.",
    })
    # Merged past the last written row, which still counts towards the tab.
    ws.merge_cells("B23:E30")


def training_classes(ws, blocks, ext=None):
    """Class blocks: the header cells, then per-level rows from row 5."""
    for name_cell, header, levels, first_col in blocks:
        cells(ws, {name_cell: header[0]})
        # Name, then type, mod 1 and talents a level below it, mod 2 beside mod 1.
        c = column_index_from_string(coordinate_from_string(name_cell)[0])
        right, next_over = get_column_letter(c + 1), get_column_letter(c + 2)
        cells(ws, {f"{right}2": header[1], f"{right}3": header[2],
                   f"{next_over}3": header[3], f"{right}4": header[4]})
        for level, values in levels:
            row(ws, f"{first_col}{4 + level}", values)
    if ext:
        cells(ws, ext)


def combat_training(ws):
    # Count, granted, progression, talent, -, sphere.
    training_classes(ws, [
        ("E1", ["Conscript", "Martial", "Str", "Dex", 1], [
            (1, [1, True, 1, "Steady Guard", None, "Shield"]),
            (2, [2, False, 2]),
            (3, ["3", 1, 3, "Lunge", None, "Fencing"]),
            (7, [5, True, 7, "Shield Wall", None, "Shield"]),
        ], "B"),
        ("K1", ["Rogue", "Skill", "Dex", None, "1/2"], [
            (1, [0, 0, 1, "Tumbler", None, "Athletics"]),
            (4, [1, True, 2, "Sure Footing", None, "Athletics"]),
        ], "H"),
    ], ext={"E26": "Conscript (epic)", "F27": "Martial", "F28": "Str", "F29": 1})

    cells(ws, {
        "U4": "Martial Tradition", "V4": "Iron Vanguard",
        "U6": "Shield Expert", "X6": "Shield", "X7": "Guardian", "U8": "Lancer Stance",
        "U12": "Bonus Talents",
        "U13": "Extra Grit", "W13": "Warleader", "X13": "Feat",
        "U15": "Brace", "W15": "Shield",
        "U18": "Bonus Ranks",
    })
    # Skill ranks: skill, enabled, current, max, multiplier.
    row(ws, "U19", ["Athletics", 1, 4, 7, 2])
    row(ws, "U20", ["Acrobatics", 0, 0, 7])
    row(ws, "U21", ["Intimidate", None, "3", 7])
    row(ws, "U22", ["Ride", True, None, 7])
    row(ws, "U23", ["Swim", "no", None, None, 0])
    # Unarmed strike.
    row(ws, "U38", ["Unarmed Strike dice", "1d6"])
    row(ws, "U39", ["Talented Knuckle", 1, "Boxing"])
    row(ws, "U40", ["Brawler's Vest", 2])
    row(ws, "U41", ["Step Increases", 1, "Other spheres:", "Wrestling"])
    row(ws, "U42", ["Size Increases", 0, "Unorthodox Strike", "Fencing"])
    row(ws, "U43", ["Uses Boxing", 1, None, 0])
    row(ws, "U44", ["Uses Open Hand", None, None, "0"])
    # Sphere bonuses, and the base DC above them.
    row(ws, "AB2", ["DC Base", 11])
    row(ws, "Z5", ["Sphere", "Rank Bonus", "DC Bonus", "Value"])
    row(ws, "Z6", ["Shield", 1, 0, "x"])
    row(ws, "Z7", ["Warleader", "2", 1, 5])


def magic_training(ws):
    training_classes(ws, [
        ("E1", ["Incanter", "High", "Int", None, 1], [
            (1, [1, True, 1, "Glow", None, "Light"]),
            (2, [2, True, 2, "Ward", None, "Protection"]),
            (3, [2, False, 3]),
        ], "B"),
    ])
    cells(ws, {
        "U2": "Tradition / Drawbacks", "V2": "Stargazer Lodge",
        "U3": "Verbal Casting", "W3": "Somatic Casting",
        "U4": "Focus Casting", "U6": "Draining Casting",
        "U8": "Boons:", "V8": 2, "W8": "3",
        "U9": "Drawback Feats", "U10": "Extra Focus", "V10": "bought off at 5th",
        "U13": "Casting Bonus Spheres",
        "U14": "Glow", "W14": "Light", "U16": "Ward", "W16": "Protection",
        "U20": "Base Global DC", "V21": 1, "W21": 15,
        "U23": "Global Caster Level", "V24": 0, "W24": 7,
        "U26": "Base MSB", "W27": "7",
        "U30": "AMT", "V30": True, "U31": "Mythic AMT", "V31": False,
        "U33": "Bonus SP", "V33": 2, "U34": "Tradition SP", "V34": 3,
        "U35": "Total SP", "V35": 12,
        "U37": "Class 1 SP", "V37": 4, "V38": "2", "V40": 0, "V41": 1,
    })
    row(ws, "Y2", ["Sphere", "CL Bonus", "DC Bonus", "Value"])
    row(ws, "Y3", ["Light", 1, 0, "7"])
    row(ws, "Y4", ["Protection", None, 2, 9])
    row(ws, "Y6", ["Telekinesis", None, None, True])


def akashic(ws):
    row(ws, "T35", ["Veil Essence", 3])


def session_notes(ws):
    row(ws, "A1", ["Session", "Date", "Notes"])
    row(ws, "A2", [1, datetime.datetime(2026, 9, 12), "Met the ferryman; paid 3 sp."])
    ws["B2"].number_format = "mm-dd-yy"
    row(ws, "A3", [2, None, "Storm — stayed in. Café closed."])
    row(ws, "A5", [True, None, None, -3.25, "#N/A", "=1+1"])
    # A time of day; lengths of time in a format of the workbook's own and in
    # a built-in one; and a time and a date and time on a half millisecond,
    # which round to the even one.
    row(ws, "A6", [datetime.time(18, 30), datetime.timedelta(hours=36),
                   datetime.timedelta(hours=-12), 0.7708333622685185, 45000.77099609375])
    ws["B6"].number_format = "[h]:mm"
    ws["C6"].number_format = "[h]:mm:ss"
    ws["D6"].number_format = "h:mm:ss"
    ws["E6"].number_format = "yyyy-mm-dd h:mm:ss"
    # An escaped underscore, which only openpyxl's shared-string reader undoes.
    row(ws, "A9", ["Tag _x005F_x0041_ kept"])


def maps(ws):
    """A tab no extractor knows, with an apostrophe in its name."""
    row(ws, "A1", ["Map", "Copies"])
    row(ws, "A2", ["Ferry crossing", 3])


def data_sheet(ws):
    row(ws, "K21", ["Score", "Cost"])
    costs = [-4, -2, -1, 0, 1, 2, 3, 5, 7, 10, 13, 17]
    for i, cost in enumerate(costs):
        row(ws, f"K{22 + i}", [7 + i, cost])
    row(ws, "K34", [True, 25])                          # TRUE is not a score of 1
    row(ws, "K35", ["Max", "n/a"])


def names(wb):
    """Workbook names: cells, a block, and the kinds both converters skip."""
    for name, ref in [
        ("CharName", "'Character Info'!$C$3"),
        ("StrMod", "'Character Info'!$D$15"),
        ("AbilityScores", "'Character Info'!$C$15:$G$20"),
        ("WalletBlock", "'Character Info'!$T$18:$V$23"),
        ("FirstPlannerLevel", "Planner!$A$2"),
        # Too big to keep, so the second area is the one read.
        ("SheetThenLevel", "'Character Info'!$A$1:$Z$100,'Character Info'!$C$6"),
        ("PointBuyCosts", "dataSheet!$K$22:$L$33"),
        ("EmptyCell", "'Character Info'!$Z$99"),
        ("EmptyBlock", "'Character Info'!$Y$90:$Z$91"),
        ("NoSuchTab", "'Missing Tab'!$A$1"),
        # An apostrophe in a tab name, doubled inside the quotes.
        ("FerryCopies", "'Marnie''s Maps'!$B$2"),
        ("HalfLevel", "3.5"),
        ("PlusOne", "LAMBDA(x,x+1)"),
        # A formula over cells, which has no cell of its own.
        ("ScoreTotal", "SUM('Character Info'!$C$15:$C$20)"),
    ]:
        wb.defined_names[name] = DefinedName(name, attr_text=ref)


# Cells openpyxl cannot write, as the type and XML body that replace each one
# in the saved file. build() puts a placeholder in each, so the cell is there.
RAW_CELLS = {
    "Marnie's Maps": {
        # Rich text kept inline: runs, and a reading guide no converter reads.
        "A3": ("inlineStr", '<is><r><rPr><b/></rPr><t>Coast road</t></r>'
                            '<r><t xml:space="preserve">, redrawn</t></r>'
                            '<rPh sb="0" eb="5"><t>こうすと</t></rPh></is>'),
    },
    "Session Notes": {
        # ISO dates (t="d"): a date and time, a date, a time with milliseconds,
        # one with a zone (which is not read), and a length of time.
        "A7": ("d", "<v>2026-10-03T18:30:00</v>"),
        "B7": ("d", "<v>2026-10-03</v>"),
        "C7": ("d", "<v>18:30:05.250</v>"),
        "D7": ("d", "<v>2026-10-03T18:30:00+02:00</v>"),
        "E7": ("d", "<v>PT1H30M</v>"),
        # Formulas with the values they last computed, as an export keeps them:
        # a number, text, a boolean, an error, and a Google-only function.
        "A8": (None, "<f>1+1</f><v>2</v>"),
        "B8": ("str", '<f>"Ferry"&amp;"man"</f><v>Ferryman</v>'),
        "C8": ("b", "<f>TRUE()</f><v>1</v>"),
        "D8": ("e", "<f>1/0</f><v>#DIV/0!</v>"),
        "E8": ("str", '<f>IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),"Spell list")</f>'
                      "<v>Spell list</v>"),
        # Rich text, which joins the shared-string table with the tab's other text.
        "B9": ("inlineStr", '<is><r><rPr><i/></rPr><t>Ferry</t></r>'
                            '<r><t xml:space="preserve"> fare: 3 sp</t></r></is>'),
    },
}

# Tabs whose text moves to the shared-string table, and the tab whose part is
# stored uncompressed along with that table.
SHARED_TABS = ("Background & Lore", "Session Notes")
STORED_TAB = "Session Notes"


def build():
    wb = openpyxl.Workbook()
    wb.properties.created = PINNED
    wb.properties.modified = PINNED
    tabs = [
        ("Character Info", character_info, "visible"),
        ("Stats", stats, "visible"),
        ("Planner", planner, "visible"),
        ("Feats", feats, "visible"),
        ("Mythic", mythic, "visible"),
        ("Equipment", equipment, "visible"),
        ("Background & Lore", background, "visible"),
        ("Combat Training", combat_training, "visible"),
        ("Magic Training", magic_training, "visible"),
        ("Akashic", akashic, "visible"),
        ("Marnie's Maps", maps, "visible"),
        ("Session Notes", session_notes, "hidden"),
        ("dataSheet", data_sheet, "hidden"),
    ]
    for i, (title, fill, state) in enumerate(tabs):
        ws = wb.active if i == 0 else wb.create_sheet()
        ws.title = title
        ws.sheet_state = state
        fill(ws)
        for ref in RAW_CELLS.get(title, {}):
            ws[ref] = "raw"
    names(wb)
    return wb


def hand_made(wb, parts):
    """Rewrite the parts openpyxl wrote: raw cells in, and the text of
    SHARED_TABS out to a shared-string table. Returns the parts to store."""
    sheet = {ws.title: f"xl/worksheets/sheet{i + 1}.xml" for i, ws in enumerate(wb.worksheets)}
    for title, raw in RAW_CELLS.items():
        xml = parts[sheet[title]].decode("utf-8")
        for ref, (kind, body) in raw.items():
            kind = f' t="{kind}"' if kind else ""
            cell = f'<c r="{ref}"{kind}>{body}</c>'
            xml, n = re.subn(rf'<c r="{ref}"[^>]*>.*?</c>', lambda m: cell, xml, count=1, flags=re.S)
            assert n == 1, (title, ref)
        parts[sheet[title]] = xml.encode("utf-8")

    strings, index, uses = [], {}, 0

    def share(m):
        nonlocal uses
        uses += 1
        if m.group(3) not in index:
            index[m.group(3)] = len(strings)
            strings.append(m.group(3))
        return f'<c {m.group(1)}t="s"{m.group(2)}><v>{index[m.group(3)]}</v></c>'

    for title in SHARED_TABS:
        xml = parts[sheet[title]].decode("utf-8")
        xml = re.sub(r'<c ([^>]*)t="inlineStr"([^>]*)><is>(.*?)</is></c>', share, xml, flags=re.S)
        parts[sheet[title]] = xml.encode("utf-8")
    parts["xl/sharedStrings.xml"] = (
        '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
        f' count="{uses}" uniqueCount="{len(strings)}">'
        + "".join(f"<si>{s}</si>" for s in strings) + "</sst>").encode("utf-8")
    # openpyxl finds the table by its content type, Excel by its relationship.
    for name, close, entry in [
        ("[Content_Types].xml", "</Types>",
         '<Override PartName="/xl/sharedStrings.xml" ContentType="application/'
         'vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>'),
        ("xl/_rels/workbook.xml.rels", "</Relationships>",
         '<Relationship Id="rIdStrings" Type="http://schemas.openxmlformats.org/'
         'officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>'),
    ]:
        parts[name] = parts[name].decode("utf-8").replace(close, entry + close).encode("utf-8")
    return {"xl/sharedStrings.xml", sheet[STORED_TAB]}


def save(wb, path):
    """Write the workbook, rewrite it by hand_made(), then repack it with fixed
    entry times."""
    raw = io.BytesIO()
    # ExcelWriter rather than wb.save, which stamps the modified time.
    ExcelWriter(wb, zipfile.ZipFile(raw, "w", zipfile.ZIP_DEFLATED)).save()
    with zipfile.ZipFile(raw) as src:
        parts = {entry.filename: src.read(entry.filename) for entry in src.infolist()}
    stored = hand_made(wb, parts)
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as dst:
        for name, data in parts.items():
            info = zipfile.ZipInfo(name, date_time=ZIP_TIME)
            info.compress_type = zipfile.ZIP_STORED if name in stored else zipfile.ZIP_DEFLATED
            info.create_system = 0
            info.external_attr = 0
            dst.writestr(info, data)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(out.getvalue())
    return len(out.getvalue())


if __name__ == "__main__":
    size = save(build(), OUT)
    print(f"wrote {OUT} ({size:,d}b)")
