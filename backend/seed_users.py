"""One-time setup script: create the admin and manager accounts.

Run inside the backend container (or locally with the same env vars set):
    docker compose exec backend python seed_users.py

It's safe to re-run -- existing usernames are skipped, not overwritten. To change
a PIN later, log in as admin and use "Reset PIN" in the dashboard instead.
"""
import getpass
import sys

from app.database import Base, engine, SessionLocal
from app.models import User
from app.auth import hash_pin

Base.metadata.create_all(bind=engine)


def prompt_pin(label: str) -> str:
    while True:
        pin = getpass.getpass(f"{label} 6-digit PIN: ").strip()
        if pin.isdigit() and len(pin) == 6:
            return pin
        print("PIN must be exactly 6 digits. Try again.")


def create_if_missing(db, username: str, role: str):
    existing = db.query(User).filter(User.username == username).first()
    if existing:
        print(f"'{username}' already exists ({existing.role}) -- skipping.")
        return
    pin = prompt_pin(f"{username} ({role})")
    db.add(User(username=username, pin_hash=hash_pin(pin), role=role))
    db.commit()
    print(f"Created {role} account '{username}'.")


def main():
    db = SessionLocal()
    try:
        print("Setting up the two real accounts (admin + manager).\n")
        admin_username = input("Admin username [travis]: ").strip() or "travis"
        create_if_missing(db, admin_username, "admin")

        manager_username = input("Manager username: ").strip()
        if not manager_username:
            print("Manager username is required.")
            sys.exit(1)
        create_if_missing(db, manager_username, "manager")
    finally:
        db.close()


if __name__ == "__main__":
    main()
