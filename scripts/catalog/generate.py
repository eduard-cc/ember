#!/usr/bin/env python3
"""Generate Gym Log's bundled exercise catalog from open, attributable sources.

Inputs (downloaded once, never fetched at runtime):
  * wger exerciseinfo dump: https://wger.de/api/v2/exerciseinfo/?limit=200 (all pages, JSON list)
  * Everkinetic data checkout: https://github.com/everkinetic/data (CC-BY-SA-4.0)

Usage:
  python3 scripts/catalog/generate.py --wger exerciseinfo.json --everkinetic ./everkinetic-data

Every catalog entry below is an explicit, reviewed mapping. Names follow the
"Exercise (Equipment)" convention and Strong's export spelling character for
character, so imported history maps 1:1. Nothing is matched by fuzzy name at
runtime.

Only line drawings are bundled (Everkinetic, or wger drawings in the Everkinetic
style), never photos. Images are cropped, resized and converted to alpha masks
(lines become opaque, paper transparent) so the app can draw them in its own
theme colour. Those modifications are stated on the Credits screen.

Requires Pillow with WebP support.
"""
import argparse
import html
import io
import json
import re
import sys
import urllib.request
from pathlib import Path

from PIL import Image, ImageChops, ImageOps

ROOT = Path(__file__).resolve().parents[2]
OUT_JSON = ROOT / 'src/catalog/exercises.json'
OUT_IMAGES = ROOT / 'src/catalog/images'
CACHE = Path.home() / '.cache/gym-log-catalog'
MAX_SIDE = 240
LEVELS = 8

# (name, body part, equipment, type, wger id, everkinetic id)
# Everkinetic id: images and steps come from Everkinetic when it has them.
# wger id: muscles and fallback instructions; its line drawings when Everkinetic has none.
CATALOG = [
    # Chest
    ('Bench Press (Barbell)', 'Chest', 'Barbell', 'weighted', 73, '0042'),
    ('Bench Press (Dumbbell)', 'Chest', 'Dumbbell', 'weighted', 75, '0055'),
    ('Bench Press (Smith Machine)', 'Chest', 'Smith machine', 'weighted', None, '0078'),
    ('Bench Press - Wide Grip (Barbell)', 'Chest', 'Barbell', 'weighted', None, '0082'),
    ('Cable Crossover', 'Chest', 'Cable', 'weighted', 323, '0048'),
    ('Chest Dip', 'Chest', 'Bodyweight', 'bodyweight', 194, '0054'),
    ('Chest Dip (Assisted)', 'Chest', 'Assisted bodyweight', 'assisted', 194, '0171'),
    ('Chest Fly', 'Chest', 'Machine', 'weighted', 135, '0047'),
    ('Chest Fly (Cable)', 'Chest', 'Cable', 'weighted', 237, '0057'),
    ('Chest Fly (Dumbbell)', 'Chest', 'Dumbbell', 'weighted', 238, '0056'),
    ('Chest Press (Machine)', 'Chest', 'Machine', 'weighted', 129, '0066'),
    ('Decline Bench Press (Barbell)', 'Chest', 'Barbell', 'weighted', 185, '0051'),
    ('Decline Bench Press (Dumbbell)', 'Chest', 'Dumbbell', 'weighted', 186, '0052'),
    ('Decline Chest Fly (Dumbbell)', 'Chest', 'Dumbbell', 'weighted', 239, '0053'),
    ('Floor Press (Dumbbell)', 'Chest', 'Dumbbell', 'weighted', 1084, None),
    ('Incline Bench Press (Barbell)', 'Chest', 'Barbell', 'weighted', 538, '0043'),
    ('Incline Bench Press (Dumbbell)', 'Chest', 'Dumbbell', 'weighted', 537, '0061'),
    ('Incline Bench Press (Dumbbell, Neutral Grip)', 'Chest', 'Dumbbell', 'weighted', None, '0059'),
    ('Incline Bench Press (Smith Machine)', 'Chest', 'Smith machine', 'weighted', 925, '0081'),
    ('Incline Chest Fly (Cable)', 'Chest', 'Cable', 'weighted', None, '0060'),
    ('Incline Chest Fly (Dumbbell)', 'Chest', 'Dumbbell', 'weighted', None, '0062'),
    ('Incline Chest Press (Machine)', 'Chest', 'Machine', 'weighted', 2632, '0084'),
    ('Pullover (Dumbbell)', 'Chest', 'Dumbbell', 'weighted', 1273, '0079'),
    ('Push Up', 'Chest', 'Bodyweight', 'bodyweight', 1551, '0077'),
    ('Push Up (Feet Elevated)', 'Chest', 'Bodyweight', 'bodyweight', 1112, '0075'),
    # Back
    ('Back Extension', 'Back', 'Bodyweight', 'bodyweight', 301, '0103'),
    ('Bent Over One Arm Row (Dumbbell)', 'Back', 'Dumbbell', 'weighted', 81, None),
    ('Bent Over Row (Barbell)', 'Back', 'Barbell', 'weighted', 83, None),
    ('Bent Over Row (Dumbbell)', 'Back', 'Dumbbell', 'weighted', 2669, None),
    ('Bent Over Row - Underhand (Barbell)', 'Back', 'Barbell', 'weighted', 84, '0026'),
    ('Chest Supported Row (Dumbbell)', 'Back', 'Dumbbell', 'weighted', 1283, None),
    ('Chin Up', 'Back', 'Bodyweight', 'bodyweight', 152, None),
    ('Chin Up (Assisted)', 'Back', 'Assisted bodyweight', 'assisted', 1737, None),
    ('Deadlift (Barbell)', 'Back', 'Barbell', 'weighted', 184, '0099'),
    ('Deadlift (Dumbbell)', 'Back', 'Dumbbell', 'weighted', 1370, '0107'),
    ('Deadlift (Smith Machine)', 'Back', 'Smith machine', 'weighted', None, '0100'),
    ('Inverted Row', 'Back', 'Bodyweight', 'bodyweight', 1198, '0086'),
    ('Iso-Lateral Row (Machine)', 'Back', 'Machine', 'weighted', 380, None),
    ('Lat Pulldown (Cable)', 'Back', 'Cable', 'weighted', 723, '0097'),
    ('Lat Pulldown (Machine)', 'Back', 'Machine', 'weighted', 2631, None),
    ('Lat Pulldown - Close Grip (Cable)', 'Back', 'Cable', 'weighted', 158, '0096'),
    ('Lat Pulldown - Underhand (Cable)', 'Back', 'Cable', 'weighted', 684, '0093'),
    ('Pendlay Row (Barbell)', 'Back', 'Barbell', 'weighted', 448, None),
    ('Pull Up', 'Back', 'Bodyweight', 'bodyweight', 475, '0087'),
    ('Pull Up (Assisted)', 'Back', 'Assisted bodyweight', 'assisted', 477, '0087'),
    ('Pullover (Machine)', 'Back', 'Machine', 'weighted', 1384, None),
    ('Rack Pull (Barbell)', 'Back', 'Barbell', 'weighted', 484, None),
    ('Seated Row (Cable)', 'Back', 'Cable', 'weighted', 394, '0025'),
    ('Seated Row (Machine)', 'Back', 'Machine', 'weighted', 1725, None),
    ('Shrug (Barbell)', 'Back', 'Barbell', 'weighted', 571, '0030'),
    ('Shrug (Cable)', 'Back', 'Cable', 'weighted', None, '0009'),
    ('Shrug (Dumbbell)', 'Back', 'Dumbbell', 'weighted', 572, '0005'),
    ('Shrug (Smith Machine)', 'Back', 'Smith machine', 'weighted', None, '0041'),
    ('Straight Arm Pulldown (Cable)', 'Back', 'Cable', 'weighted', 1726, '0092'),
    ('Superman', 'Back', 'Bodyweight', 'bodyweight', None, '0105'),
    ('T Bar Row', 'Back', 'Barbell', 'weighted', 513, '0029'),
    # Shoulders
    ('Arnold Press (Dumbbell)', 'Shoulders', 'Dumbbell', 'weighted', 20, '0006'),
    ('External Rotation (Cable)', 'Shoulders', 'Cable', 'weighted', 142, None),
    ('Face Pull (Cable)', 'Shoulders', 'Cable', 'weighted', 222, None),
    ('Front Raise (Barbell)', 'Shoulders', 'Barbell', 'weighted', None, '0007'),
    ('Front Raise (Cable)', 'Shoulders', 'Cable', 'weighted', 1731, '0008'),
    ('Front Raise (Dumbbell)', 'Shoulders', 'Dumbbell', 'weighted', 256, '0033'),
    ('Incline Shoulder Press (Dumbbell)', 'Shoulders', 'Dumbbell', 'weighted', None, '0031'),
    ('Internal Rotation (Cable)', 'Shoulders', 'Cable', 'weighted', 1728, '0034'),
    ('Lateral Raise (Cable)', 'Shoulders', 'Cable', 'weighted', 1378, None),
    ('Lateral Raise (Dumbbell)', 'Shoulders', 'Dumbbell', 'weighted', 348, '0018'),
    ('Lateral Raise (Machine)', 'Shoulders', 'Machine', 'weighted', 1744, None),
    ('Lying Reverse Fly (Dumbbell)', 'Shoulders', 'Dumbbell', 'weighted', None, '0023'),
    ('Overhead Press (Barbell)', 'Shoulders', 'Barbell', 'weighted', 566, None),
    ('Overhead Press (Dumbbell, One Arm)', 'Shoulders', 'Dumbbell', 'weighted', 1968, '0038'),
    ('Overhead Press (Smith Machine)', 'Shoulders', 'Smith machine', 'weighted', 569, None),
    ('Push Press (Barbell)', 'Shoulders', 'Barbell', 'weighted', 478, None),
    ('Rear Delt Row (Barbell)', 'Shoulders', 'Barbell', 'weighted', None, '0028'),
    ('Rear Delt Row (Dumbbell)', 'Shoulders', 'Dumbbell', 'weighted', 1227, '0024'),
    ('Reverse Fly (Band)', 'Shoulders', 'Band', 'weighted', None, '0020'),
    ('Reverse Fly (Cable)', 'Shoulders', 'Cable', 'weighted', 822, '0017'),
    ('Reverse Fly (Dumbbell)', 'Shoulders', 'Dumbbell', 'weighted', 2643, '0032'),
    ('Reverse Fly (Machine)', 'Shoulders', 'Machine', 'weighted', 1775, None),
    ('Seated Overhead Press (Barbell)', 'Shoulders', 'Barbell', 'weighted', 566, '0011'),
    ('Seated Overhead Press (Dumbbell)', 'Shoulders', 'Dumbbell', 'weighted', 567, '0012'),
    ('Seated Reverse Fly (Cable)', 'Shoulders', 'Cable', 'weighted', None, '0035'),
    ('Shoulder Press (Machine)', 'Shoulders', 'Machine', 'weighted', 543, '0003'),
    ('Strict Military Press (Barbell)', 'Shoulders', 'Barbell', 'weighted', 566, None),
    ('Upright Row (Barbell)', 'Shoulders', 'Barbell', 'weighted', None, '0014'),
    ('Upright Row (Cable)', 'Shoulders', 'Cable', 'weighted', None, '0015'),
    ('Upright Row (Dumbbell)', 'Shoulders', 'Dumbbell', 'weighted', 694, '0016'),
    ('Upright Row (Smith Machine)', 'Shoulders', 'Smith machine', 'weighted', 691, '0013'),
    # Arms
    ('Bench Dip', 'Arms', 'Bodyweight', 'bodyweight', 197, '0162'),
    ('Bench Press - Close Grip (Barbell)', 'Arms', 'Barbell', 'weighted', 76, '0049'),
    ('Bicep Curl (Barbell)', 'Arms', 'Barbell', 'weighted', 91, '0211'),
    ('Bicep Curl (Cable)', 'Arms', 'Cable', 'weighted', 95, '0212'),
    ('Bicep Curl (Dumbbell)', 'Arms', 'Dumbbell', 'weighted', 92, '0224'),
    ('Bicep Curl (Dumbbell, Alternating)', 'Arms', 'Dumbbell', 'weighted', 1012, '0223'),
    ('Bicep Curl (Machine)', 'Arms', 'Machine', 'weighted', 1424, '0253'),
    ('Close Grip Push Up', 'Arms', 'Bodyweight', 'bodyweight', None, '0188'),
    ('Concentration Curl (Dumbbell)', 'Arms', 'Dumbbell', 'weighted', 202, '0220'),
    ('Cross Body Hammer Curl (Dumbbell)', 'Arms', 'Dumbbell', 'weighted', None, '0221'),
    ('Drag Curl (Barbell)', 'Arms', 'Barbell', 'weighted', None, '0222'),
    ('EZ Bar Curl', 'Arms', 'Barbell', 'weighted', 94, '0226'),
    ('Hammer Curl (Cable)', 'Arms', 'Cable', 'weighted', 275, '0216'),
    ('Hammer Curl (Dumbbell)', 'Arms', 'Dumbbell', 'weighted', 272, '0227'),
    ('Incline Curl (Dumbbell)', 'Arms', 'Dumbbell', 'weighted', 204, '0214'),
    ('JM Press (Barbell)', 'Arms', 'Barbell', 'weighted', 1302, '0175'),
    ('One Arm Triceps Extension (Dumbbell)', 'Arms', 'Dumbbell', 'weighted', None, '0200'),
    ('Overhead Curl (Cable)', 'Arms', 'Cable', 'weighted', None, '0238'),
    ('Overhead Triceps Extension (Dumbbell)', 'Arms', 'Dumbbell', 'weighted', None, '0192'),
    ('Preacher Curl (Barbell)', 'Arms', 'Barbell', 'weighted', 465, '0239'),
    ('Preacher Curl (Cable)', 'Arms', 'Cable', 'weighted', None, '0217'),
    ('Preacher Curl (Dumbbell)', 'Arms', 'Dumbbell', 'weighted', None, '0249'),
    ('Preacher Curl (Machine)', 'Arms', 'Machine', 'weighted', 2633, '0236'),
    ('Reverse Curl (Dumbbell)', 'Arms', 'Dumbbell', 'weighted', 495, '0257'),
    ('Reverse Grip Triceps Pushdown (Cable)', 'Arms', 'Cable', 'weighted', None, '0189'),
    ('Reverse Wrist Curl (Barbell)', 'Arms', 'Barbell', 'weighted', 48, None),
    ('Seated Bicep Curl (Dumbbell)', 'Arms', 'Dumbbell', 'weighted', None, '0243'),
    ('Seated Palms Up Wrist Curl (Dumbbell)', 'Arms', 'Dumbbell', 'weighted', 1205, None),
    ('Skullcrusher (Barbell)', 'Arms', 'Barbell', 'weighted', 246, '0183'),
    ('Skullcrusher (Dumbbell)', 'Arms', 'Dumbbell', 'weighted', 245, '0181'),
    ('Spider Curl (Barbell)', 'Arms', 'Barbell', 'weighted', 1465, '0245'),
    ('Tate Press (Dumbbell)', 'Arms', 'Dumbbell', 'weighted', None, '0203'),
    ('Triceps Dip', 'Arms', 'Bodyweight', 'bodyweight', 194, '0172'),
    ('Triceps Dip (Assisted)', 'Arms', 'Assisted bodyweight', 'assisted', 1372, '0171'),
    ('Triceps Extension', 'Arms', 'Dumbbell', 'weighted', 1336, '0198'),
    ('Triceps Extension (Barbell)', 'Arms', 'Barbell', 'weighted', 50, '0201'),
    ('Triceps Extension (Cable)', 'Arms', 'Cable', 'weighted', 1513, '0178'),
    ('Triceps Extension (Machine)', 'Arms', 'Machine', 'weighted', 661, '0210'),
    ('Triceps Kickback (Dumbbell)', 'Arms', 'Dumbbell', 'weighted', 655, '0204'),
    ('Triceps Pushdown (Cable - Rope)', 'Arms', 'Cable', 'weighted', 1900, '0206'),
    ('Triceps Pushdown (Cable - V-Bar)', 'Arms', 'Cable', 'weighted', None, '0207'),
    ('Triceps Pushdown (Cable)', 'Arms', 'Cable', 'weighted', 1185, '0205'),
    ('Wrist Curl (Barbell)', 'Arms', 'Barbell', 'weighted', 51, None),
    ('Zottman Curl (Dumbbell)', 'Arms', 'Dumbbell', 'weighted', 1683, '0251'),
    # Legs
    ('Belt Squat (Machine)', 'Legs', 'Machine', 'weighted', 1935, None),
    ('Box Jump', 'Legs', 'Bodyweight', 'bodyweight', 1373, None),
    ('Box Squat (Barbell)', 'Legs', 'Barbell', 'weighted', None, '0133'),
    ('Bulgarian Split Squat', 'Legs', 'Dumbbell', 'weighted', 1706, None),
    ('Calf Press on Leg Press', 'Legs', 'Machine', 'weighted', 146, '0273'),
    ('Donkey Calf Raise', 'Legs', 'Machine', 'weighted', None, '0275'),
    ('Front Squat (Barbell)', 'Legs', 'Barbell', 'weighted', 257, '0138'),
    ('Glute Bridge', 'Legs', 'Bodyweight', 'bodyweight', 265, '0109'),
    ('Glute Kickback (Cable)', 'Legs', 'Cable', 'weighted', 1131, '0112'),
    ('Glute Kickback (Machine)', 'Legs', 'Machine', 'weighted', 1723, None),
    ('Goblet Squat (Dumbbell)', 'Legs', 'Dumbbell', 'weighted', 203, None),
    ('Good Morning (Barbell)', 'Legs', 'Barbell', 'weighted', 1392, '0101'),
    ('Hack Squat', 'Legs', 'Machine', 'weighted', 1414, '0123'),
    ('Hack Squat (Barbell)', 'Legs', 'Barbell', 'weighted', 43, '0125'),
    ('Hip Abductor (Machine)', 'Legs', 'Machine', 'weighted', 1748, '0156'),
    ('Hip Adductor (Machine)', 'Legs', 'Machine', 'weighted', 12, '0157'),
    ('Hip Thrust (Barbell)', 'Legs', 'Barbell', 'weighted', 294, None),
    ('Leg Extension (Machine)', 'Legs', 'Machine', 'weighted', 369, '0142'),
    ('Leg Press', 'Legs', 'Machine', 'weighted', 371, '0127'),
    ('Lunge (Barbell)', 'Legs', 'Barbell', 'weighted', 46, '0114'),
    ('Lunge (Bodyweight)', 'Legs', 'Bodyweight', 'bodyweight', 984, None),
    ('Lunge (Dumbbell)', 'Legs', 'Dumbbell', 'weighted', 205, '0115'),
    ('Lying Leg Curl (Machine)', 'Legs', 'Machine', 'weighted', 365, '0117'),
    ('Narrow Stance Leg Press', 'Legs', 'Machine', 'weighted', 373, '0143'),
    ('Overhead Squat (Barbell)', 'Legs', 'Barbell', 'weighted', 441, '0151'),
    ('Pistol Squat', 'Legs', 'Bodyweight', 'bodyweight', 456, None),
    ('Reverse Lunge (Barbell)', 'Legs', 'Barbell', 'weighted', None, '0128'),
    ('Reverse Lunge (Dumbbell)', 'Legs', 'Dumbbell', 'weighted', 1651, '0129'),
    ('Romanian Deadlift (Barbell)', 'Legs', 'Barbell', 'weighted', 507, '0118'),
    ('Romanian Deadlift (Dumbbell)', 'Legs', 'Dumbbell', 'weighted', 1652, None),
    ('Seated Calf Raise (Barbell)', 'Legs', 'Barbell', 'weighted', None, '0272'),
    ('Seated Calf Raise (Machine)', 'Legs', 'Machine', 'weighted', 2628, '0279'),
    ('Seated Leg Curl (Machine)', 'Legs', 'Machine', 'weighted', 366, '0119'),
    ('Seated Leg Press (Machine)', 'Legs', 'Machine', 'weighted', 371, '0127'),
    ('Single Leg Deadlift (Dumbbell)', 'Legs', 'Dumbbell', 'weighted', 1736, None),
    ('Sissy Squat', 'Legs', 'Bodyweight', 'bodyweight', None, '0158'),
    ('Split Squat (Dumbbell)', 'Legs', 'Dumbbell', 'weighted', 1366, None),
    ('Squat (Barbell)', 'Legs', 'Barbell', 'weighted', 1801, '0122'),
    ('Squat (Bodyweight)', 'Legs', 'Bodyweight', 'bodyweight', 1312, None),
    ('Squat (Dumbbell)', 'Legs', 'Dumbbell', 'weighted', None, '0130'),
    ('Squat (Smith Machine)', 'Legs', 'Smith machine', 'weighted', 1747, '0124'),
    ('Standing Calf Raise (Barbell)', 'Legs', 'Barbell', 'weighted', None, '0281'),
    ('Standing Calf Raise (Dumbbell)', 'Legs', 'Dumbbell', 'weighted', 2661, '0283'),
    ('Standing Calf Raise (Machine)', 'Legs', 'Machine', 'weighted', 622, '0282'),
    ('Standing Calf Raise (Smith Machine)', 'Legs', 'Smith machine', 'weighted', None, '0280'),
    ('Standing Leg Curl (Machine)', 'Legs', 'Machine', 'weighted', 367, '0120'),
    ('Step Up (Barbell)', 'Legs', 'Barbell', 'weighted', None, '0134'),
    ('Step Up (Dumbbell)', 'Legs', 'Dumbbell', 'weighted', 981, '0137'),
    ('Stiff Leg Deadlift (Barbell)', 'Legs', 'Barbell', 'weighted', 627, None),
    ('Sumo Deadlift (Barbell)', 'Legs', 'Barbell', 'weighted', 630, None),
    ('Walking Lunge (Dumbbell)', 'Legs', 'Dumbbell', 'weighted', 206, '0121'),
    ('Zercher Squat (Barbell)', 'Legs', 'Barbell', 'weighted', None, '0161'),
    # Core
    ('Ab Rollout (Barbell)', 'Core', 'Barbell', 'bodyweight', 41, '0285'),
    ('Ab Wheel', 'Core', 'Other', 'bodyweight', 1573, None),
    ('Bent Knee Hip Raise', 'Core', 'Bodyweight', 'bodyweight', None, '0287'),
    ('Bicycle Crunch', 'Core', 'Bodyweight', 'bodyweight', 1412, None),
    ('Cable Crunch', 'Core', 'Cable', 'weighted', 173, None),
    ('Cross Body Crunch', 'Core', 'Bodyweight', 'bodyweight', 576, '0289'),
    ('Crunch', 'Core', 'Bodyweight', 'bodyweight', 167, '0291'),
    ('Crunch (Machine)', 'Core', 'Machine', 'weighted', 172, None),
    ('Crunch (Stability Ball)', 'Core', 'Other', 'bodyweight', 165, '0295'),
    ('Decline Crunch', 'Core', 'Bodyweight', 'bodyweight', 171, '0292'),
    ('Flat Bench Leg Raise', 'Core', 'Bodyweight', 'bodyweight', None, '0021'),
    ('Flutter Kicks', 'Core', 'Bodyweight', 'bodyweight', None, '0116'),
    ('Hanging Knee Raise', 'Core', 'Bodyweight', 'bodyweight', 978, None),
    ('Hanging Leg Raise', 'Core', 'Bodyweight', 'bodyweight', 283, None),
    ('Hollow Hold', 'Core', 'Bodyweight', 'duration', 297, None),
    ('Lying Leg Raise', 'Core', 'Bodyweight', 'bodyweight', 377, '0111'),
    ('Mountain Climber', 'Core', 'Bodyweight', 'bodyweight', 996, None),
    ('Oblique Crunch (Decline)', 'Core', 'Bodyweight', 'bodyweight', None, '0293'),
    ('Pallof Press (Cable)', 'Core', 'Cable', 'weighted', 1194, None),
    ('Plank', 'Core', 'Bodyweight', 'duration', 458, None),
    ('Russian Twist', 'Core', 'Bodyweight', 'bodyweight', 1193, None),
    ('Side Bend (Dumbbell)', 'Core', 'Dumbbell', 'weighted', 1650, '0294'),
    ('Side Plank', 'Core', 'Bodyweight', 'duration', 580, '0113'),
    ('Sit Up', 'Core', 'Bodyweight', 'bodyweight', 591, None),
    ('Stability Ball Pull In', 'Core', 'Other', 'bodyweight', None, '0296'),
    ('Woodchopper (Cable)', 'Core', 'Cable', 'weighted', 145, None),
    # Cardio
    ('Air Bike', 'Cardio', 'Cardio machine', 'cardio', None, '0284'),
    ('Cycling (Stationary Bike)', 'Cardio', 'Cardio machine', 'cardio', 624, None),
    ('Elliptical Trainer', 'Cardio', 'Cardio machine', 'cardio', 962, None),
    ('Jump Rope', 'Cardio', 'Other', 'duration', 993, None),
    ('Jumping Jack', 'Cardio', 'Bodyweight', 'bodyweight', 320, None),
    ('Rowing (Machine)', 'Cardio', 'Cardio machine', 'cardio', 1093, None),
    ('Running (Treadmill)', 'Cardio', 'Cardio machine', 'cardio', 530, None),
    ('Ski Erg', 'Cardio', 'Cardio machine', 'cardio', 1526, None),
    ('Stair Climber', 'Cardio', 'Cardio machine', 'cardio', 1548, None),
    # Full body / Olympic
    ('Burpee', 'Full body', 'Bodyweight', 'bodyweight', 132, None),
    ('Clean (Barbell)', 'Full body', 'Barbell', 'weighted', 1438, None),
    ('Clean and Press (Barbell)', 'Full body', 'Barbell', 'weighted', 1901, None),
    ('Farmer\'s Walk (Dumbbell)', 'Full body', 'Dumbbell', 'weighted', 1116, None),
    ('Kettlebell Swing', 'Full body', 'Kettlebell', 'weighted', 960, None),
    ('Power Clean (Barbell)', 'Full body', 'Barbell', 'weighted', 683, None),
    ('Snatch (Barbell)', 'Full body', 'Barbell', 'weighted', 599, None),
    ('Thruster (Barbell)', 'Full body', 'Barbell', 'weighted', 650, None),
]

# Everkinetic ids without a usable drawing in its own dist/ fall back to wger drawings.
# App-owned muscle tags where no attributable source lists them (facts, not copied text).
MANUAL_MUSCLES = {
    'Reverse Fly (Machine)': (['Shoulders'], ['Trapezius']),
    'Seated Palms Up Wrist Curl (Dumbbell)': (['Forearms'], []),
    'Wrist Curl (Barbell)': (['Forearms'], []),
    'Reverse Wrist Curl (Barbell)': (['Forearms'], []),
    'Mountain Climber': (['Abs'], ['Shoulders', 'Quads']),
    'Running (Treadmill)': (['Quads', 'Calves'], ['Hamstrings', 'Glutes']),
    'Cycling (Stationary Bike)': (['Quads'], ['Hamstrings', 'Calves', 'Glutes']),
    'Jump Rope': (['Calves'], ['Shoulders', 'Quads']),
    'Burpee': (['Quads', 'Chest'], ['Shoulders', 'Abs', 'Triceps']),
    "Farmer's Walk (Dumbbell)": (['Forearms', 'Trapezius'], ['Abs', 'Glutes']),
}
MUSCLE_NAMES = {
    # wger Latin -> plain English
    'Anterior deltoid': 'Shoulders', 'Gluteus maximus': 'Glutes', 'Rectus abdominis': 'Abs',
    'Latissimus dorsi': 'Lats', 'Quadriceps femoris': 'Quads', 'Triceps brachii': 'Triceps',
    'Biceps brachii': 'Biceps', 'Pectoralis major': 'Chest', 'Trapezius': 'Traps',
    'Biceps femoris': 'Hamstrings', 'Obliquus externus abdominis': 'Obliques',
    'Gastrocnemius': 'Calves', 'Brachialis': 'Brachialis', 'Serratus anterior': 'Serratus',
    'Soleus': 'Calves',
    # Everkinetic
    'biceps brachii': 'Biceps', 'triceps brachii': 'Triceps', 'pectoralis major': 'Chest',
    'quadriceps': 'Quads', 'deltoid': 'Shoulders', 'abdominals': 'Abs',
    'latissimus dorsi': 'Lats', 'gastrocnemius': 'Calves', 'soleus': 'Calves',
    'ischiocrural muscles': 'Hamstrings', 'erector spinae': 'Lower back',
    'trapezius': 'Traps', 'glutaeus maximus': 'Glutes', 'obliques': 'Obliques',
}
LICENSES = {
    'CC-BY-SA 3': ('CC BY-SA 3.0', 'https://creativecommons.org/licenses/by-sa/3.0/'),
    'CC-BY-SA 4': ('CC BY-SA 4.0', 'https://creativecommons.org/licenses/by-sa/4.0/'),
    'CC-BY 4': ('CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/'),
    'CC0': ('CC0 1.0', 'https://creativecommons.org/publicdomain/zero/1.0/'),
}
WGER_LICENSE_IDS = {1: 'CC-BY-SA 3', 2: 'CC-BY-SA 4', 3: 'CC0', 4: 'CC-BY 4'}
EK_LICENSE = LICENSES['CC-BY-SA 4']


def slug(name):
    return re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')


def text_steps(description):
    """wger HTML description -> list of plain sentences/steps."""
    items = re.findall(r'<li>(.*?)</li>', description, flags=re.S)
    if not items:
        plain = re.sub(r'<[^>]+>', ' ', description)
        items = re.split(r'(?<=[.!?])\s+(?=[A-Z])', plain)
    out = []
    for item in items:
        item = html.unescape(re.sub(r'<[^>]+>', ' ', item))
        item = re.sub(r'\s+', ' ', item).strip()
        if len(item) > 3:
            out.append(item)
    return out


def unclear(author):
    """Exclude prose attributed to external fitness publishers without a verified open grant."""
    return bool(author) and any(name in author.lower() for name in ('exrx', 'mens fitness', "men's fitness"))


def line_mask(raw):
    """Crop a line drawing and turn it into an alpha mask (ink opaque, paper transparent)."""
    image = Image.open(io.BytesIO(raw))
    if image.mode in ('RGBA', 'LA', 'P'):
        image = image.convert('RGBA')
        background = Image.new('RGBA', image.size, 'white')
        image = Image.alpha_composite(background, image)
    gray = image.convert('L')
    ink = ImageOps.invert(gray)
    ink = ink.point(lambda v: 0 if v < 24 else v)
    box = ink.getbbox()
    if box:
        pad = 8
        box = (max(0, box[0] - pad), max(0, box[1] - pad),
               min(ink.width, box[2] + pad), min(ink.height, box[3] + pad))
        ink = ink.crop(box)
    ink.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
    # Eight ink levels keep anti-aliased edges and compress losslessly to a few KB.
    ink = ink.point(lambda v: min(255, round(v / 255 * (LEVELS - 1)) * (255 // (LEVELS - 1))))
    rgba = Image.new('RGBA', ink.size, (0, 0, 0, 0))
    rgba.putalpha(ink)
    buffer = io.BytesIO()
    rgba.save(buffer, 'WEBP', lossless=True, method=4)
    return buffer.getvalue(), rgba.size


def fetch(url):
    CACHE.mkdir(parents=True, exist_ok=True)
    target = CACHE / re.sub(r'[^A-Za-z0-9._-]+', '_', url.split('://', 1)[1])
    if not target.exists():
        request = urllib.request.Request(url, headers={'User-Agent': 'gym-log-catalog-generator'})
        with urllib.request.urlopen(request, timeout=20) as response:
            target.write_bytes(response.read())
    return target.read_bytes()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--wger', required=True, type=Path)
    parser.add_argument('--everkinetic', required=True, type=Path)
    args = parser.parse_args()
    wger = {e['id']: e for e in json.loads(args.wger.read_text())}
    ek_root = args.everkinetic
    everkinetic = {e['id']: e for e in json.loads((ek_root / 'dist/exercises.json').read_text())}

    names = [entry[0] for entry in CATALOG]
    duplicates = {n for n in names if names.count(n) > 1}
    if duplicates:
        sys.exit(f'duplicate catalog names: {sorted(duplicates)}')

    if OUT_IMAGES.exists():
        for old in OUT_IMAGES.glob('*.webp'):
            old.unlink()
    OUT_IMAGES.mkdir(parents=True, exist_ok=True)
    entries, total_bytes = [], 0
    for name, body, equipment, kind, wger_id, ek_id in CATALOG:
        print(name, file=sys.stderr, flush=True)
        w = wger.get(wger_id) if wger_id else None
        if wger_id and not w:
            sys.exit(f'{name}: wger {wger_id} missing from dump')
        ek = everkinetic.get(ek_id) if ek_id else None
        if ek_id and not ek:
            sys.exit(f'{name}: everkinetic {ek_id} missing')
        english = None
        if w:
            english = next((t for t in w['translations'] if t['language'] == 2), None)
        sources, steps, steps_source = [], [], None
        if ek and ek.get('steps'):
            steps = [re.sub(r'\s+', ' ', s).strip() for s in ek['steps'] if s.strip()]
            steps_source = 'everkinetic'
        elif english and english.get('description') and not unclear(english.get('license_author')):
            steps = text_steps(english['description'])
            steps_source = 'wger'
        primary, secondary = [], []
        if w and not unclear(w.get('license_author')):
            primary = [MUSCLE_NAMES.get(m['name'], m['name_en'] or m['name']) for m in w['muscles']]
            secondary = [MUSCLE_NAMES.get(m['name'], m['name_en'] or m['name'])
                         for m in w['muscles_secondary']]
        if not primary and ek:
            primary = [MUSCLE_NAMES.get(m, m.title()) for m in ek.get('primary', [])]
            secondary = [MUSCLE_NAMES.get(m, m.title()) for m in ek.get('secondary', [])]
        if not primary and name in MANUAL_MUSCLES:
            primary, secondary = (list(x) for x in MANUAL_MUSCLES[name])
        primary = list(dict.fromkeys(primary))
        secondary = [m for m in dict.fromkeys(secondary) if m not in primary]

        # Images: Everkinetic start/end drawings, else wger line drawings (style 1, never AI).
        images, image_source = [], None
        if ek_id:
            files = [ek_root / f'dist/png/{ek_id}-relaxation.png', ek_root / f'dist/png/{ek_id}-tension.png']
            if all(f.exists() for f in files):
                images = [f.read_bytes() for f in files]
                image_source = {
                    'title': ek['title'], 'author': 'Everkinetic', 'license': EK_LICENSE[0],
                    'licenseUrl': EK_LICENSE[1],
                    'url': 'https://github.com/everkinetic/data',
                }
        if not images and w:
            drawings = [i for i in w['images'] if i['style'] == '1' and not i['is_ai_generated']
                        and not unclear(i.get('license_author'))]
            drawings.sort(key=lambda i: i['image'])
            if drawings:
                images = [fetch(i['image']) for i in drawings[:2]]
                lic = LICENSES[WGER_LICENSE_IDS[drawings[0]['license']]]
                image_source = {
                    'title': english['name'] if english else name,
                    'author': drawings[0]['license_author'] or 'wger.de contributors',
                    'license': lic[0], 'licenseUrl': lic[1],
                    'url': f'https://wger.de/exercise/{wger_id}/view-base',
                }
        # Some Everkinetic drawings exist only as finished source exports (src/images-ai,
        # start "-S" then finish "-F"), not in dist/. Same artist, licence and attribution.
        if not images and ek_id:
            files = [ek_root / f'src/images-ai/{ek_id}-S.ai.png', ek_root / f'src/images-ai/{ek_id}-F.ai.png']
            if all(f.exists() for f in files):
                images = [f.read_bytes() for f in files]
                image_source = {
                    'title': ek['title'], 'author': 'Everkinetic', 'license': EK_LICENSE[0],
                    'licenseUrl': EK_LICENSE[1],
                    'url': 'https://github.com/everkinetic/data',
                }
        files_out = []
        for index, raw in enumerate(images):
            data, size = line_mask(raw)
            file = f'{slug(name)}-{index}.webp'
            (OUT_IMAGES / file).write_bytes(data)
            total_bytes += len(data)
            files_out.append({'file': file, 'width': size[0], 'height': size[1]})
        if image_source:
            sources.append({'kind': 'illustration', **image_source,
                            'changes': 'cropped, resized and recoloured'})
        if steps_source == 'everkinetic':
            sources.append({'kind': 'instructions', 'title': ek['title'], 'author': 'Everkinetic',
                            'license': EK_LICENSE[0], 'licenseUrl': EK_LICENSE[1],
                            'url': 'https://github.com/everkinetic/data',
                            'changes': 'whitespace normalised'})
        elif steps_source == 'wger':
            lic = LICENSES[WGER_LICENSE_IDS[english['license']]]
            sources.append({'kind': 'instructions', 'title': english['name'],
                            'author': english['license_author'] or 'wger.de contributors',
                            'license': lic[0], 'licenseUrl': lic[1],
                            'url': f'https://wger.de/exercise/{wger_id}/view-base',
                            'changes': 'converted to plain text'})
        if w and w['muscles'] and primary and not unclear(w.get('license_author')) \
                and steps_source != 'wger':
            lic = LICENSES[WGER_LICENSE_IDS[w['license']['id']]]
            sources.append({'kind': 'muscles', 'title': english['name'] if english else name,
                            'author': w['license_author'] or 'wger.de contributors',
                            'license': lic[0], 'licenseUrl': lic[1],
                            'url': f'https://wger.de/exercise/{wger_id}/view-base'})
        entries.append({
            'name': name, 'bodyPart': body, 'equipment': equipment, 'type': kind,
            'primaryMuscles': primary, 'secondaryMuscles': secondary,
            'instructions': steps[:12], 'images': files_out, 'sources': sources,
        })
    OUT_JSON.write_text(json.dumps(entries, indent=1, ensure_ascii=False) + '\n')
    with_images = sum(1 for e in entries if e['images'])
    print(f'{len(entries)} exercises, {with_images} with drawings, '
          f'{sum(len(e["images"]) for e in entries)} images, {total_bytes / 1024:.0f} KiB')


if __name__ == '__main__':
    main()
