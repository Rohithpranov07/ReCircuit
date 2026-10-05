FROM python:3.12-slim
WORKDIR /srv/api
COPY pyproject.toml ./
RUN pip install --no-cache-dir "fastapi==0.142.2" "uvicorn[standard]==0.54.0" "pydantic==2.13.5" \
    "psycopg[binary,pool]==3.3.6" \
    "pyjwt==2.15.1" "passlib[bcrypt]==1.7.4" "bcrypt==4.0.1" "qrcode[pil]==8.2" "slowapi==0.1.10"
COPY app ./app
EXPOSE 8000
CMD ["uvicorn", "app.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000"]
