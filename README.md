# POSVEN PRO3 — SQLite local y varias cajas por red local

Aplicación de punto de venta para Windows, construida con Next.js y Electron.

## Arquitectura de datos

- **SQLite es la única base de datos operativa.** El archivo `posven.sqlite` se guarda en la carpeta de datos de usuario de Windows del equipo servidor.
- No se requiere conexión a Internet para ventas y operaciones dentro de la red local.
- El equipo servidor ejecuta la aplicación y expone la API en la red local por el puerto TCP `9002`. Las demás cajas se conectan a la IP IPv4 que muestra el servidor.
- Las cajas cliente no abren ni comparten directamente el archivo SQLite: las operaciones pasan por la API del servidor, que mantiene la base de datos y aplica las transacciones.
- El servidor debe permanecer encendido y conectado a la misma red. Se recomienda reservar su IP en el router.
- El instalador agrega una regla del Firewall de Windows limitada al perfil de red privada y al puerto TCP 9002.

## Primera configuración de las cajas

Al iniciar el instalador por primera vez, seleccione una opción:

1. **Esta PC será el servidor:** esta caja alojará la base de datos y mostrará su IP de red. Anote la IP para configurarla en las demás cajas.
2. **Conectar esta caja a un servidor:** introduzca la IP que muestra la caja servidor.

Todas las cajas deben estar conectadas a la misma LAN y usar la misma versión compatible. Use la IPv4 privada de la red local, no una IP pública.

La configuración se guarda en `network.json` dentro de la carpeta de datos de usuario de Electron. Para cambiar modo o IP, cierre la aplicación y elimine ese archivo; el asistente aparecerá en el siguiente inicio.

## Datos, persistencia y respaldo

El adaptador SQLite mantiene la base en memoria durante la ejecución y guarda cada escritura en `posven.sqlite` mediante un archivo temporal, sincronización a disco y sustitución atómica. No se generan archivos `-wal` ni `-shm`. Cierre POSVEN Pro correctamente antes de copiar la base de datos y guarde copias periódicas en otro disco o ubicación protegida.

En una instalación con varias cajas, el servidor es la autoridad única. Si el servidor o la red se desconectan, las cajas cliente no deben registrar operaciones como si se hubieran guardado localmente.

## Administrador semilla

Si no existe ningún administrador activo, el sistema crea o recupera el usuario semilla `admin`, correo `admin@posven.local`, rol administrador y contraseña inicial predeterminada `admin123`. Cámbiela al iniciar por primera vez. Si existe otro administrador activo, no se crea una cuenta semilla adicional.

## Generar el instalador de Windows

En GitHub Actions, ejecute **Build Windows EXE (SQLite LAN)** y descargue el artefacto `PosVEN-Pro3-Windows-Installer`. La compilación se genera en un runner Windows.
