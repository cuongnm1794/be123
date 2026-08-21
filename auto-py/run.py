"""CLI test — chay: python run.py"""
from mouse import click_at

X, Y = -906, 963

if __name__ == "__main__":
    print(f"Move to ({X}, {Y}) then click...")
    click_at(X, Y)
    print("Done.")
