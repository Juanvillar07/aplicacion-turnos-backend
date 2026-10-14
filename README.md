# AgendaBarrio · Backend

SaaS multi-inquilino de agendamiento para microempresas locales (barberías, estéticas, consultorios, canchas sintéticas): reservas por web o WhatsApp y pagos con Nequi / Daviplata.

**Stack:** NestJS · Prisma 6 · PostgreSQL 16 (Docker) · JWT (`@nestjs/jwt` + Passport) · Amazon SES · WhatsApp Cloud API.

| Repositorio | Contenido |
|-------------|-----------|
| [aplicacion-turnos-backend](https://github.com/Juanvillar07/aplicacion-turnos-backend) | Este: API, base de datos (Docker), correos y WhatsApp |
| [aplicacion-turnos-frontend](https://github.com/Juanvillar07/aplicacion-turnos-frontend) | Panel, página pública de reservas y asistente "Crear tu negocio" |

## Hoja de ruta

| Fase | Alcance | Estado |
|------|---------|--------|
| 0 | Registro e inicio de sesión (JWT) | ✅ |
| 1 | Núcleo multi-inquilino: negocios, roles, servicios, profesionales/espacios, horarios | ✅ |
| 2 | Disponibilidad, página pública de reservas `/b/:slug`, agenda diaria y bloqueos | ✅ |
| 3 | Clientes, correos (Amazon SES), reprogramar y cuenta (recuperar contraseña, verificar correo) | ✅ |
| 4 | Equipo: roles (administrador y profesional), invitaciones por correo y agenda por profesional | ✅ |
| 5 | Pagos con Wompi (Nequi, PSE) + comprobante Daviplata | ⏸️ pendiente de pasarela |
| 6 | WhatsApp: avisos al cliente y bot de reservas por chat | ✅ |
| 7 | Superadministrador: panel `/admin`, negocios, suspender/reactivar y métricas globales | ✅ (planes, prueba gratis y cobro: tras la pasarela de pagos) |
| 7.1 | "Crear tu negocio": plan → cuenta → pago (simulado) → negocio; suscripción por negocio | ✅ (cobro real con la pasarela) |
| E | Experiencia del cliente: página pública con logo, fotos, mapa y redes; reseñas verificadas; "Agregar a mi calendario" | ✅ (lista de espera: pendiente) |
| 8 | Puesta en producción | |

## Requisitos
- Node.js 22+
- Docker Desktop

## Puesta en marcha

```bash
# 1. Base de datos (PostgreSQL 16 en Docker)
docker compose up -d

# 2. API  →  http://localhost:3000/api
cp .env.example .env        # cambia JWT_SECRET
npm install                 # ejecuta "prisma generate"
npx prisma migrate dev
npm run db:seed             # opcional: datos de demostración
npm run start:dev
```

El frontend corre aparte (ver su repositorio) en http://localhost:5173.

`docker-compose.yml` fija `name: aplicacion-agenda-turnos` para usar siempre el mismo volumen de datos (`aplicacion-agenda-turnos_pgdata`), sin importar la carpeta desde la que se ejecute.

**Usuario demo** (tras `npm run db:seed`): `demo@agendabarrio.co` / `demo12345`, administrador de "Barbería Don Juan", con 3 servicios, 2 barberos ("sin cuenta"), horario de lunes a sábado, citas de ejemplo para hoy y mañana y un bloqueo.

**Página pública del demo:** http://localhost:5173/b/barberia-don-juan

Pruebas del motor de disponibilidad: `npm test`.

## Correos (Amazon SES por SMTP)

Sin `SMTP_HOST` en `.env`, los correos **no se envían**: se guardan como HTML en `.emails/` (y se anuncian en la consola) para revisarlos en desarrollo.

Para enviar de verdad con Amazon SES:

1. **SES → Configuration → Identities → Create identity**: verifica el correo remitente (o tu dominio, con DKIM, para producción).
2. **SES → SMTP settings → Create SMTP credentials**: genera usuario y contraseña SMTP (no son las de tu cuenta AWS ni las del *ingress endpoint* de Mail Manager, que sirve para **recibir** correo).
3. En `.env`:
   ```
   SMTP_HOST=email-smtp.us-east-1.amazonaws.com
   SMTP_PORT=587
   SMTP_USER=<usuario SMTP>
   SMTP_PASS=<contraseña SMTP>
   MAIL_FROM="AgendaBarrio <tu-correo-verificado@ejemplo.com>"
   ```
4. Mientras la cuenta esté en **sandbox**, SES solo entrega a direcciones verificadas. Para escribir a cualquier cliente: *Account dashboard → Request production access*.

Cada envío queda registrado en la tabla `email_logs` (SENT, FAILED o PREVIEW). Un correo fallido nunca bloquea la reserva.

> En Windows, detén el backend antes de correr `prisma migrate` o `prisma generate`; si no, el motor de Prisma queda bloqueado (error `EPERM`).

## WhatsApp (Cloud API de Meta)

- **Avisos al cliente** (confirmación, aprobación, cancelación, reprogramación) si el negocio activó WhatsApp en *Configuración* y el cliente dejó marcada la casilla al reservar. Si el cliente escribió en las últimas 24 h se envía **texto libre (gratis)**; si no, una **plantilla aprobada** por Meta. "STOP" desactiva los avisos.
- **Bot de reservas**: el cliente escribe al número de la plataforma (o abre el enlace `wa.me` del negocio, que identifica el negocio por su slug), elige servicio → profesional → día → hora, da su nombre (y correo opcional) y reserva. También lista y cancela sus citas.
- **Simulador** en el panel (*Simulador WhatsApp*, solo con `npm run dev`): conversa con el bot real sin pasar por Meta.
- Sin `WHATSAPP_TOKEN` los mensajes se guardan en `.whatsapp/` (vista previa). Todo queda en la tabla `whatsapp_messages`.

### Conectar Meta
1. En *developers.facebook.com → tu app → WhatsApp → Configuración de la API*: copia el **token**, el **Phone number ID** y el **WhatsApp Business Account ID** a `.env` (`WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`). `WHATSAPP_DISPLAY_NUMBER` es el número del bot con indicativo, solo dígitos.
2. Crea las plantillas: `npm run whatsapp:templates` (Meta las revisa; normalmente en minutos).
3. **Webhook** (para que el bot reciba mensajes): Meta necesita una URL pública HTTPS. En desarrollo usa un túnel:
   ```
   cloudflared tunnel --url http://localhost:3000
   ```
   En *WhatsApp → Configuración → Webhook*: URL `https://<tu-túnel>/api/whatsapp/webhook`, token de verificación = `WHATSAPP_VERIFY_TOKEN` del `.env`, y suscríbete al campo **messages**. Para producción agrega `WHATSAPP_APP_SECRET` (Configuración de la app → Básica) y el backend verificará la firma de cada webhook.
4. Con el número de prueba de Meta solo puedes escribir a los (hasta 5) números que agregaste como destinatarios.
5. Clientes con **nombre de usuario** de WhatsApp: Meta puede ocultar su número y enviar solo su BSUID (`CO.123…`). El bot les responde por ese id y les pide el celular al reservar; en "Mis citas" solo ven las reservadas desde ese chat. En modo de prueba Meta no puede cruzar el BSUID con la lista de destinatarios (error 131030).

## Roles del equipo

| Rol | Puede |
|-----|-------|
| **Administrador** (`ADMIN`) | El dueño o un encargado: gestiona todo (negocio, servicios, equipo, horarios, bloqueos, agenda y clientes). No atiende, así que no tiene columna en la agenda. Siempre debe quedar al menos uno. |
| **Profesional** (`STAFF`) | Quien atiende (barbero, estilista, médico…): solo **su** agenda, donde ve, crea y gestiona sus citas. Ve los datos de contacto y la sección Clientes. No configura nada ni bloquea horarios. |

El tercer rol, el **superadministrador**, es de la plataforma, no de un negocio (ver abajo).

- **Profesionales:** se agregan solo por invitación desde *Barberos / Profesionales* (correo válido 7 días). Cuando aceptan y crean su cuenta, aparecen en ese listado con su nombre y todos los servicios activos, listos para que les asignes horario. Mientras tanto se ven como "Invitación pendiente".
- **Columnas "sin cuenta":** son profesionales que existen sin cuenta (p. ej. los del seed). Conservan su horario y sus citas, y tienen un botón **Invitar**: al aceptar, la persona queda vinculada a esa misma columna.
- **Espacios (canchas):** se crean directamente, sin invitación.
- **Administradores:** se invitan desde *Miembros*.
- **Cambio de rol:** de profesional a administrador, su columna queda "sin cuenta". Si vuelve a ser profesional, la recupera.
- **Avisos de reservas:** llegan a los administradores y al profesional de la cita.

## Crear tu negocio y suscripciones

No hay registro libre: las cuentas se crean al **crear un negocio** (`/crear-negocio`) o al aceptar una invitación. `/register` redirige a `/crear-negocio`.

Pasos del asistente:
1. **Plan:** Básico ($39.900), Pro ($69.900) o Premium ($109.900) al mes. Los planes están en la tabla `plans` y se crean con la migración. Sus límites todavía no se aplican.
2. **Cuenta:** nombre, email y contraseña. El plan elegido queda como suscripción `PENDING_PAYMENT`.
3. **Verificación:** llega al correo un código de 6 dígitos que hay que escribir para continuar.
4. **Pago:** activa la suscripción.
5. **Negocio:** con la suscripción `ACTIVE` se crea el negocio, y la suscripción queda vinculada a él.

**Verificación del correo:**
- El código vence en **10 minutos**. Tras **5 intentos fallidos** hay que pedir otro, y se puede reenviar **una vez por minuto**.
- En la tabla `email_verification_codes` solo se guarda un HMAC del código (con el id del usuario y `JWT_SECRET`), nunca el código.
- Pagar o crear el negocio sin el correo verificado responde **403**.
- Mientras la cuenta no esté verificada ni tenga negocios, se puede corregir el correo (`PATCH /api/auth/email`), y llega un código nuevo.
- Las cuentas antiguas sin verificar ven un aviso en el panel con "Verificar ahora". Ya no hay enlace de verificación: `/verify-email` redirige al panel.
- Las personas invitadas quedan verificadas al aceptar la invitación desde su correo.

**Contraseñas:** al crear la cuenta (y al aceptar una invitación, restablecer o cambiar la contraseña) se escribe dos veces. Debe tener mínimo 8 caracteres, una mayúscula y un carácter especial. El formulario muestra los requisitos en vivo y el backend aplica la misma regla (`@IsStrongPassword()` en `common/validation`). Las contraseñas anteriores siguen sirviendo para iniciar sesión.

Si la persona cierra la página, al volver a iniciar sesión `/onboarding` retoma el paso según su suscripción "suelta" (la que aún no tiene negocio). Cada negocio, incluido un segundo negocio, necesita su propia suscripción. Sin ella, `POST /api/businesses` responde **402**.

**Pago simulado** (no se cobra nada):
- `4242 4242 4242 4242` aprueba y `4000 0000 0000 0002` rechaza. Sirven con cualquier fecha futura y cualquier CVC.
- El formulario valida la tarjeta (Luhn y fecha), pero al backend solo envía la marca y los últimos 4 dígitos. El número completo y el CVC nunca salen del navegador.
- Cada intento queda registrado en `subscription_payments`.
- Para conectar Wompi basta con otra implementación de `PaymentGateway` (`src/subscriptions/payment-gateway.ts`).

Los negocios que ya existían recibieron un año del plan **Pro de cortesía**. El administrador ve su plan, la próxima renovación y los pagos en *Configuración → Suscripción*. El superadmin ve el plan de cada negocio, los ingresos del mes y los negocios por plan.

## Página pública, reseñas y calendario

**Página pública (`/b/:slug`).** El administrador la configura en *Configuración → Página pública*:
- Logo, descripción (hasta 600 caracteres), Instagram, Facebook y sitio web.
- Galería de hasta 8 fotos.

La página muestra además un mapa de Google y el botón "Cómo llegar", a partir de la dirección y sin clave de API, más el teléfono, WhatsApp y las reseñas.

**Imágenes:**
- Se suben a `POST /businesses/:id/logo` y `/photos`, en multipart con el campo `file`, de hasta 5 MB.
- `sharp` valida el formato real (JPG, PNG o WebP), corrige la rotación, reduce el tamaño (logo: 512 px; fotos: 1600 px), convierte a WebP y **quita los metadatos EXIF**, incluida la ubicación GPS.
- Se guardan con `StorageService`. Hoy es `LocalDiskStorage`, que escribe en `uploads/` (ignorada por git) y el backend sirve en `/uploads` con caché de 30 días. Las URLs se arman con `PUBLIC_API_URL`.
- Para producción basta una implementación de S3 en `StorageModule`.

**Reseñas verificadas:**
1. Al marcar una cita como **Completada** se crea un enlace único (`/resena/:token`, vale 30 días). Llega al cliente por correo, y por WhatsApp si lo aceptó (plantilla `agenda_resena`).
2. El cliente califica de 1 a 5 estrellas con un comentario opcional. Solo una reseña por cita.
3. La reseña se publica al instante, con el nombre abreviado ("Laura G."), y los administradores reciben un aviso.
4. En *Panel → Reseñas* pueden **responder** (la respuesta se ve en la página) u **ocultar** (no sale ni cuenta en el promedio).

**Calendario:**
- `GET /public/appointments/:token/calendar.ics` genera el evento con recordatorio 1 hora antes, para Apple u Outlook.
- El frontend también arma el enlace de Google Calendar.

> Corre `npm run whatsapp:templates` para crear `agenda_resena` en Meta. Meta podría clasificarla como *marketing*.

## Superadministrador (plataforma)

Es el dueño de AgendaBarrio, no de un negocio. Se asigna desde la terminal (a propósito no hay forma de hacerlo desde la web):

```bash
npm run superadmin -- tu@correo.com            # dar el rol (el usuario debe estar registrado)
npm run superadmin -- tu@correo.com --revoke   # quitarlo
npm run superadmin -- --list                   # ver quiénes lo tienen
```

En `/admin` (o el enlace **Superadmin** del menú) ve las métricas globales del mes (negocios, usuarios, citas por canal, correos y WhatsApp enviados/fallidos, evolución de 6 meses, categorías y negocios más activos), la lista de negocios con búsqueda y filtro por estado, y la ficha de cada uno para dar soporte (equipo, uso, fallos de envío recientes e historial). No ve datos de los clientes de los negocios.

**Suspender un negocio** (con motivo, se avisa por correo a los administradores): la página `/b/:slug` y el bot dejan de aceptar reservas, el panel queda en solo lectura (el backend rechaza todo lo que no sea `GET`) con un aviso del motivo, y los clientes todavía pueden cancelar sus citas, pero no reprogramarlas. Reactivarlo lo deja todo como antes. Cada acción queda en el historial (`admin_actions`).

## Multi-tenancy

Esquema compartido: cada tabla de negocio tiene `business_id`. Las rutas privadas de un negocio cuelgan de `/api/businesses/:businessId/...` y pasan por:

1. `JwtAuthGuard`: usuario autenticado.
2. `BusinessMemberGuard`: el usuario es miembro de `:businessId` (si no, 403) y, con `@Roles('ADMIN')`, tiene el rol requerido.
3. Los servicios siempre consultan con `where: { id, businessId }`, así que un id de otro negocio devuelve 404.

Ambos guards se aplican con el decorador `@BusinessScoped()`.

## Endpoints

| Método | Ruta | Rol | Descripción |
|--------|------|-----|-------------|
| POST | `/api/auth/register` | — | Crear cuenta → `{ accessToken, user }` (lo usa el paso "Cuenta" de `/crear-negocio`) |
| POST | `/api/auth/login` | — | Iniciar sesión → `{ accessToken, user }` |
| GET | `/api/auth/me` | autenticado | Usuario actual |
| POST | `/api/auth/forgot-password` | — | Envía enlace para restablecer (misma respuesta exista o no el correo) |
| POST | `/api/auth/reset-password` | — | `{ token, password }` |
| POST | `/api/auth/verify-email` | autenticado | `{ code }` (6 dígitos) → usuario verificado. 400 con los intentos restantes si falla |
| GET | `/api/auth/verification-status` | autenticado | `{ hasActiveCode, resendAvailableAt }`; no envía nada |
| POST | `/api/auth/resend-verification` | autenticado | Envía un código nuevo (429 si no ha pasado un minuto) |
| PATCH | `/api/auth/email` | autenticado | `{ email }` · corrige el correo de una cuenta sin verificar y sin negocios; devuelve una sesión nueva |
| PATCH | `/api/auth/password` | autenticado | `{ currentPassword, newPassword }` |
| PATCH | `/api/auth/profile` | autenticado | `{ name }` |
| POST | `/api/businesses` | autenticado | Crear negocio (queda como ADMIN; slug automático). Exige una suscripción pagada sin negocio; si no la hay, 402 |
| GET | `/api/businesses` | autenticado | Mis negocios con mi rol |
| GET | `/api/businesses/slug-available?slug=` | autenticado | ¿Enlace disponible? |
| GET | `/api/businesses/:businessId` | miembro | Detalle |
| PATCH | `/api/businesses/:businessId` | ADMIN | Editar datos / slug |
| GET | `/api/businesses/:businessId/services?includeInactive=` | miembro | Servicios |
| POST · PATCH · DELETE | `/api/businesses/:businessId/services[/:id]` | ADMIN | CRUD (DELETE = desactivar) |
| GET | `/api/businesses/:businessId/resources?includeInactive=` | miembro | Profesionales / espacios con `serviceIds` y `workingHours` |
| POST · PATCH · DELETE | `/api/businesses/:businessId/resources[/:id]` | ADMIN | CRUD (DELETE = desactivar). POST solo crea espacios (`SPACE`): los profesionales llegan por invitación |
| PUT | `/api/businesses/:businessId/resources/:id/services` | ADMIN | `{ serviceIds }` |
| PUT | `/api/businesses/:businessId/resources/:id/working-hours` | ADMIN | `{ hours: [{ dayOfWeek, startMinute, endMinute }] }`; reemplaza el horario y valida solapes |
| GET | `/api/businesses/:businessId/appointments?date=YYYY-MM-DD` | miembro | Citas del día con cliente, servicio y recurso |
| GET | `/api/businesses/:businessId/appointments/pending-count` | miembro | Reservas futuras por confirmar |
| POST | `/api/businesses/:businessId/appointments` | miembro | Cita manual (sin aviso mínimo, queda CONFIRMED) |
| PATCH | `/api/businesses/:businessId/appointments/:id/status` | miembro | Confirmar, completar, no asistió o cancelar |
| GET | `/api/businesses/:businessId/availability?serviceId&date&resourceId?` | miembro | Turnos libres para citas manuales |
| GET | `/api/businesses/:businessId/customers?search=&page=` | miembro | Clientes paginados con estadísticas |
| GET · PATCH | `/api/businesses/:businessId/customers/:id` | miembro | Ficha con historial · guardar `{ notes }` |
| GET · POST · DELETE | `/api/businesses/:businessId/time-offs[/:id]` | GET miembro, resto ADMIN | Bloqueos de tiempo; POST devuelve las citas que se cruzan |
| GET | `/api/businesses/:businessId/team` | ADMIN | Miembros (con su columna vinculada) e invitaciones pendientes |
| POST | `/api/businesses/:businessId/team/invitations` | ADMIN | `{ email, role, resourceId? }` · `resourceId` solo para profesionales (columna "sin cuenta"); envía el correo |
| POST · DELETE | `/api/businesses/:businessId/team/invitations/:id[/resend]` | ADMIN | Reenviar · revocar |
| PATCH | `/api/businesses/:businessId/team/members/:id` | ADMIN | `{ role }` · profesional ↔ administrador (crea o libera su columna) |
| DELETE | `/api/businesses/:businessId/team/members/:id` | ADMIN · uno mismo | Quitar a alguien o salir del negocio |
| GET | `/api/invitations/:token` | — | Datos de la invitación (negocio, rol, si ya tiene cuenta) |
| POST | `/api/invitations/:token/accept` | autenticado | Aceptar con la cuenta actual (mismo correo) |
| POST | `/api/invitations/:token/register` | — | `{ name, password }` · crea la cuenta, acepta y devuelve la sesión |
| GET | `/api/whatsapp/info` | — | ¿Meta configurado?, número del bot, ¿simulador disponible? |
| GET · POST | `/api/whatsapp/webhook` | Meta | Verificación del webhook · mensajes entrantes (firma HMAC si hay `WHATSAPP_APP_SECRET`) |
| POST | `/api/whatsapp/simulate` | autenticado, solo desarrollo | `{ phone, text? | replyId? }` → respuestas del bot |

**Suscripciones:**

| Método | Ruta | Acceso | Descripción |
|--------|------|--------|-------------|
| GET | `/api/plans` | — | Planes activos |
| GET | `/api/subscriptions/current` | autenticado | Suscripción "suelta" del usuario (o `null`): en qué paso va |
| POST | `/api/subscriptions` | autenticado | `{ planCode }` · elige o cambia el plan antes de pagar |
| POST | `/api/subscriptions/:id/pay` | autenticado | `{ cardBrand, cardLast4, holderName }` · 402 si se rechaza |
| GET | `/api/businesses/:businessId/subscription` | ADMIN | Plan, vigencia e historial de pagos |

**Superadministrador** (JWT + `is_super_admin`, se revalida en cada petición):

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/admin/metrics` | Métricas globales del mes e historial de 6 meses |
| GET | `/api/admin/businesses?search&status&page` | Negocios con administrador, estado y citas del mes |
| GET | `/api/admin/businesses/:id` | Ficha de soporte: equipo, uso, fallos recientes e historial |
| POST | `/api/admin/businesses/:id/suspend` | `{ reason }` · suspende y avisa a los administradores |
| POST | `/api/admin/businesses/:id/reactivate` | Reactiva y avisa a los administradores |

**Página pública y reseñas:**

| Método | Ruta | Acceso | Descripción |
|--------|------|--------|-------------|
| POST · DELETE | `/api/businesses/:businessId/logo` | ADMIN | Subir (multipart `file`) o quitar el logo |
| GET · POST | `/api/businesses/:businessId/photos` | ADMIN | Fotos de la galería · subir una (máx. 8) |
| PUT | `/api/businesses/:businessId/photos/order` | ADMIN | `{ ids }` en el nuevo orden |
| DELETE | `/api/businesses/:businessId/photos/:photoId` | ADMIN | Borrar una foto (y su archivo) |
| GET | `/api/businesses/:businessId/reviews?rating&page` | ADMIN | Reseñas (incluidas las ocultas) y resumen |
| PATCH | `/api/businesses/:businessId/reviews/:id` | ADMIN | `{ reply?, hidden? }` |
| GET | `/api/public/b/:slug/reviews?page` | — | Reseñas publicadas, de 5 en 5 |
| GET · POST | `/api/public/reviews/:token` | — | Datos del enlace para calificar · `{ rating, comment? }` |
| GET | `/api/public/appointments/:token/calendar.ics` | — | Evento de calendario de la cita |

`PATCH /api/businesses/:businessId` acepta además `description`, `instagramUrl`, `facebookUrl` y `websiteUrl` (`""` o `null` los borra). `GET /api/public/b/:slug` incluye el logo, las fotos, la calificación y la primera página de reseñas.

**Rutas públicas** (sin sesión, limitadas a 120 peticiones/min por IP y 10 reservas/min):

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/public/b/:slug` | Perfil público: servicios y profesionales/espacios |
| GET | `/api/public/b/:slug/availability/days?serviceId&resourceId?` | Días con turnos libres |
| GET | `/api/public/b/:slug/availability?serviceId&date&resourceId?` | Turnos de un día |
| POST | `/api/public/b/:slug/appointments` | Reservar `{ serviceId, resourceId|null, startsAt, customer: { name, email, phone } }` |
| GET | `/api/public/appointments/:token` | Ver una cita (enlace privado del cliente) |
| POST | `/api/public/appointments/:token/cancel` | Cancelarla |
| GET | `/api/public/appointments/:token/reschedule/days` · `/slots?date=` | Turnos para reprogramar (mismo servicio y profesional) |
| POST | `/api/public/appointments/:token/reschedule` | `{ startsAt }`; respeta la anticipación mínima |

## Reservas sin doble agendamiento

- **Motor de disponibilidad** (`src/availability/availability.engine.ts`): función pura, probada con Jest. Toma las franjas del día en la zona del negocio (`America/Bogota`), descuenta citas y bloqueos y ofrece turnos cada `slotStepMinutes` respetando el aviso mínimo.
- **Al reservar** se vuelve a calcular la disponibilidad; el turno tiene que estar en la lista.
- **En la base de datos**, la restricción `appointments_no_overlap` (`EXCLUDE USING gist`) impide que dos citas pendientes o confirmadas del mismo recurso se crucen, aunque lleguen al mismo tiempo. Si pasa, la API responde 409.

## Arquitectura

```
src/
├── prisma/        PrismaModule (global)
├── users/         UsersModule: acceso a usuarios (no conoce Auth)
├── auth/          AuthModule: registro, login, JwtStrategy, JwtAuthGuard
├── common/        tenancy/ (BusinessMemberGuard, @Roles, @BusinessScoped, @CurrentMembership), validation/ (@IsStrongPassword), utils/
├── businesses/    BusinessesModule: negocios y membresías
├── catalog/       CatalogModule: servicios
├── resources/     ResourcesModule: profesionales/espacios, servicios asignados y horarios
├── availability/  Motor de disponibilidad (función pura + servicio)
├── customers/     Clientes del negocio (upsert por celular)
├── appointments/  Reservas y agenda del panel
├── time-offs/     Bloqueos de tiempo
├── public-booking/ Rutas públicas para clientes finales
├── mail/          Envío SMTP (SES) o vista previa en .emails, y plantillas HTML
├── notifications/ Qué correos enviar ante cada evento de una cita
├── team/          Miembros, roles, invitaciones y vínculo persona ↔ columna de la agenda
├── subscriptions/ Planes, suscripciones y pasarela de pago (hoy simulada)
├── admin/         Panel del superadministrador: métricas, negocios, suspender/reactivar
└── whatsapp/      Cliente de la Cloud API, plantillas, bot de reservas, webhook y simulador
```
