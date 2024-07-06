import sys
import numpy as np

wei = sys.argv[1]

def format_float(num):
    return np.format_float_positional(num, trim='-')

print(format_float(int(wei) / 1e9))