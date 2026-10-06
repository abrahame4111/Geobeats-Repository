# Local development shortcuts. Run `make help`.
VENV := .venv
PY   := $(VENV)/bin/python

.PHONY: help env setup mongo mongo-stop backend web test

help:
	@echo "make setup       one-time: env files, Python venv, web dependencies"
	@echo "make mongo       start local MongoDB (Docker)"
	@echo "make backend     run API on http://127.0.0.1:8001"
	@echo "make web         run web app on http://127.0.0.1:3000"
	@echo "make test        run backend tests (backend must be running)"
	@echo "make mongo-stop  stop local MongoDB"

env:
	@test -f backend/.env  || (cp backend/.env.example backend/.env   && echo "created backend/.env  - add your Spotify and Google Maps keys")
	@test -f frontend/.env || (cp frontend/.env.example frontend/.env && echo "created frontend/.env")

setup: env
	python3 -m venv $(VENV)
	$(PY) -m pip install -q -r backend/requirements.txt
	cd frontend && yarn install

mongo:
	docker compose up -d mongo

mongo-stop:
	docker compose stop mongo

backend:
	cd backend && ../$(PY) -m uvicorn server:app --reload --host 127.0.0.1 --port 8001

web:
	cd frontend && yarn start

test:
	cd backend && ../$(PY) -m pytest tests -q --ignore=tests/legacy
