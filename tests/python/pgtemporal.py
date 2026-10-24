"""Un PostgreSQL desechable para las pruebas (no toca tu Supabase).

Levanta un servidor en una carpeta temporal, sin red (solo un socket local), y lo borra al terminar.
Hace falta tener PostgreSQL instalado (initdb, pg_ctl, psql); si no está, las pruebas que lo usan se
saltan solas. Si se corre como root (p. ej. en la nube), usa el usuario "postgres".
"""
import glob
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest


def _bin(nombre):
    ruta = shutil.which(nombre)
    if ruta:
        return ruta
    for candidato in sorted(glob.glob(f"/usr/lib/postgresql/*/bin/{nombre}"), reverse=True):
        return candidato
    return None


class ClusterTemporal:
    def __init__(self):
        self.initdb, self.pg_ctl, self.psql_bin = _bin("initdb"), _bin("pg_ctl"), _bin("psql")
        if not (self.initdb and self.pg_ctl and self.psql_bin):
            pytest.skip("PostgreSQL no está instalado (initdb/pg_ctl/psql): se omiten estas pruebas")
        self.dir = Path(tempfile.mkdtemp(prefix="lobo-pg-"))
        os.chmod(self.dir, 0o755)
        self.prefijo = []
        if hasattr(os, "geteuid") and os.geteuid() == 0:
            self.prefijo = ["runuser", "-u", "postgres", "--"]
            shutil.chown(self.dir, "postgres", "postgres")
        self.puerto = 54000 + (os.getpid() % 900)
        datos = self.dir / "datos"
        self.iniciado = False
        self._correr([self.initdb, "-D", str(datos), "-A", "trust", "-U", "postgres", "-E", "UTF8"])
        self._correr([self.pg_ctl, "-D", str(datos), "-w", "-l", str(self.dir / "pg.log"),
                      "-o", f"-p {self.puerto} -k {self.dir} -c listen_addresses=''", "start"])
        self.iniciado = True

    def _correr(self, cmd):
        r = subprocess.run(self.prefijo + cmd, capture_output=True, text=True, timeout=120)
        if r.returncode != 0:
            raise RuntimeError(f"Falló {' '.join(cmd)}:\n{r.stdout}\n{r.stderr}")
        return r

    def detener(self):
        try:
            if self.iniciado:
                self._correr([self.pg_ctl, "-D", str(self.dir / "datos"), "-m", "immediate", "-w", "stop"])
        finally:
            shutil.rmtree(self.dir, ignore_errors=True)

    def psql(self, db, sql, parar_en_error=True):
        """Corre SQL con psql. Devuelve (código, salida, avisos)."""
        cmd = [self.psql_bin, "-X", "-q", "-h", str(self.dir), "-p", str(self.puerto), "-U", "postgres", "-d", db,
               "-v", f"ON_ERROR_STOP={1 if parar_en_error else 0}", "-f", "-"]
        r = subprocess.run(cmd, input=sql, capture_output=True, text=True, timeout=300)
        return r.returncode, r.stdout, r.stderr

    def psql_ok(self, db, sql):
        codigo, salida, avisos = self.psql(db, sql)
        assert codigo == 0, f"psql falló:\n{avisos}"
        return salida

    def consulta(self, db, sql):
        """Una consulta que devuelve filas simples (separadas por |)."""
        cmd = [self.psql_bin, "-X", "-A", "-t", "-h", str(self.dir), "-p", str(self.puerto), "-U", "postgres", "-d", db, "-c", sql]
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        assert r.returncode == 0, r.stderr
        return [fila for fila in r.stdout.strip().split("\n") if fila]

    def valor(self, db, sql):
        """Una consulta que devuelve UN solo texto (puede tener varias líneas)."""
        cmd = [self.psql_bin, "-X", "-A", "-t", "-h", str(self.dir), "-p", str(self.puerto), "-U", "postgres", "-d", db, "-c", sql]
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        assert r.returncode == 0, r.stderr
        return r.stdout.strip()

    def archivo(self, db, ruta):
        """Corre un archivo .sql completo y devuelve la salida."""
        return self.psql_ok(db, open(ruta, encoding="utf-8").read())

    def base_nueva(self, nombre, plantilla=None):
        extra = f" template {plantilla}" if plantilla else ""
        self.psql_ok("postgres", f"create database {nombre}{extra};")
        return nombre

    def preparar_supabase_falso(self, db):
        """Imita lo mínimo que Supabase ya trae: roles anon / authenticated / service_role, el esquema auth con
        auth.jwt(), y los permisos por defecto sobre lo que se cree después en public."""
        self.psql_ok(db, """
            create role anon nologin;
            create role authenticated nologin;
            create role service_role nologin bypassrls;
            create schema auth;
            create function auth.jwt() returns jsonb language sql stable as $$
              select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
            grant usage on schema public, auth to anon, authenticated, service_role;
            -- Igual que Supabase: lo que se cree después queda abierto a anon/authenticated/service_role.
            alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
            alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
        """)
