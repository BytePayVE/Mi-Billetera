-- ============================================================================
-- PAGOBYTE: SCRIPT SQL MAESTRO + SEGURIDAD (v9)
-- Ejecutar completo en el SQL Editor de Supabase (es 100% seguro de re-ejecutar)
-- Incluye: Tiendas Aliadas, KYC, Buró Interno, Notificaciones Realtime + Triggers
--          y ByteCode (PIN dinámico de 6 dígitos / Confirmación en 1 Toque)
-- ============================================================================

-- 1. SOLICITUDES DE AFILIACIÓN Y TIENDAS ALIADAS
CREATE TABLE IF NOT EXISTS solicitudes_tiendas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre_comercial VARCHAR(140) NOT NULL,
    rif VARCHAR(25) NOT NULL,
    representante_legal VARCHAR(120) NOT NULL,
    telefono_contacto VARCHAR(25) NOT NULL,
    correo VARCHAR(120) NOT NULL,
    ciudad_direccion TEXT NOT NULL,
    categoria_productos VARCHAR(100) NOT NULL,
    banco_pago_movil VARCHAR(80) NOT NULL,
    telefono_pago_movil VARCHAR(25) NOT NULL,
    estado VARCHAR(25) NOT NULL DEFAULT 'pendiente'
        CHECK (estado IN ('pendiente', 'en_entrevista', 'aprobada', 'rechazada')),
    notas_entrevista TEXT NULL,
    creada_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tiendas_aliadas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    solicitud_id UUID REFERENCES solicitudes_tiendas(id),
    codigo_numerico VARCHAR(15) UNIQUE NOT NULL CHECK (codigo_numerico ~ '^[0-9]+$'),
    nombre_comercial VARCHAR(140) NOT NULL,
    rif VARCHAR(25) UNIQUE NOT NULL,
    correo VARCHAR(120) UNIQUE NOT NULL,
    clave_acceso TEXT NOT NULL,
    banco_pago_movil VARCHAR(80) NOT NULL,
    telefono_pago_movil VARCHAR(25) NOT NULL,
    activa BOOLEAN NOT NULL DEFAULT TRUE,
    aprobada_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE solicitudes_tiendas ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiendas_aliadas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Comercios envian solicitud" ON solicitudes_tiendas;
CREATE POLICY "Comercios envian solicitud" ON solicitudes_tiendas FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Admin gestiona solicitudes tiendas" ON solicitudes_tiendas;
CREATE POLICY "Admin gestiona solicitudes tiendas" ON solicitudes_tiendas FOR ALL USING (public.es_admin());

DROP POLICY IF EXISTS "Login tiendas aprobadas" ON tiendas_aliadas;
CREATE POLICY "Login tiendas aprobadas" ON tiendas_aliadas FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admin aprueba y gestiona tiendas" ON tiendas_aliadas;
CREATE POLICY "Admin aprueba y gestiona tiendas" ON tiendas_aliadas FOR ALL USING (public.es_admin());

-- 2. COLUMNAS KYC, DOMICILIO Y BURÓ INTERNO EN TABLA CLIENTES
ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS fase INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS puntos INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS estado VARCHAR(60),
  ADD COLUMN IF NOT EXISTS ciudad VARCHAR(100),
  ADD COLUMN IF NOT EXISTS tipo_zona VARCHAR(40),
  ADD COLUMN IF NOT EXISTS direccion_detalle TEXT,
  ADD COLUMN IF NOT EXISTS foto_cedula_path TEXT,
  ADD COLUMN IF NOT EXISTS foto_selfie_path TEXT,
  ADD COLUMN IF NOT EXISTS kyc_verificado BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS suspendido BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS motivo_suspension TEXT NULL;

-- Bucket privado para fotos KYC (Cédula + Selfie)
INSERT INTO storage.buckets (id, name, public)
VALUES ('kyc_documentos', 'kyc_documentos', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Subida de fotos KYC al registrarse" ON storage.objects;
CREATE POLICY "Subida de fotos KYC al registrarse"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'kyc_documentos');

DROP POLICY IF EXISTS "Admin consulta fotos KYC" ON storage.objects;
CREATE POLICY "Admin consulta fotos KYC"
ON storage.objects FOR SELECT
USING (bucket_id = 'kyc_documentos' AND public.es_admin());

-- 3. ENTREGAS Y VINCULACIÓN DE TIENDAS EN COMPRAS
ALTER TABLE compras
  ADD COLUMN IF NOT EXISTS tienda_id UUID REFERENCES tiendas_aliadas(id),
  ADD COLUMN IF NOT EXISTS entregado BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS entregado_en TIMESTAMPTZ NULL;

-- 4. NOTIFICACIONES 100% EN SUPABASE (SIN FIREBASE, SIN COSTOS)
CREATE TABLE IF NOT EXISTS notificaciones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_id UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    titulo VARCHAR(140) NOT NULL,
    mensaje TEXT NOT NULL,
    tipo VARCHAR(30) NOT NULL DEFAULT 'info',
    leida BOOLEAN NOT NULL DEFAULT FALSE,
    creada_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE notificaciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Cliente ve sus propias notificaciones" ON notificaciones;
CREATE POLICY "Cliente ve sus propias notificaciones" ON notificaciones FOR SELECT USING (auth.uid() = cliente_id);

DROP POLICY IF EXISTS "Cliente marca sus notificaciones como leidas" ON notificaciones;
CREATE POLICY "Cliente marca sus notificaciones como leidas" ON notificaciones FOR UPDATE USING (auth.uid() = cliente_id);

DROP POLICY IF EXISTS "Admin inserta notificaciones" ON notificaciones;
CREATE POLICY "Admin inserta notificaciones" ON notificaciones FOR INSERT WITH CHECK (public.es_admin());

-- Habilitar Realtime para notificaciones (ignora error si ya estaba agregada)
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE notificaciones;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Triggers automáticos de notificaciones (Oferta aprobada + Pago verificado/rechazado)
CREATE OR REPLACE FUNCTION fn_notificar_nueva_oferta()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.estado = 'por_aceptar' THEN
    INSERT INTO notificaciones (cliente_id, titulo, mensaje, tipo)
    VALUES (
      NEW.cliente_id,
      '¡Tienes una oferta aprobada!',
      'Pagobyte aprobó tu solicitud. Entra a la pestaña Cuotas para revisar las condiciones y aceptar tu compromiso.',
      'oferta'
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_notificar_nueva_oferta ON compras;
CREATE TRIGGER trg_notificar_nueva_oferta
AFTER INSERT ON compras
FOR EACH ROW EXECUTE FUNCTION fn_notificar_nueva_oferta();

CREATE OR REPLACE FUNCTION fn_notificar_estado_pago()
RETURNS TRIGGER AS $$
DECLARE
  v_cliente_id UUID;
BEGIN
  IF OLD.estado IS DISTINCT FROM NEW.estado AND NEW.estado IN ('verificado', 'rechazado') THEN
    SELECT c.cliente_id INTO v_cliente_id
    FROM cuotas q
    JOIN compras c ON c.id = q.compra_id
    WHERE q.id = NEW.cuota_id;

    IF v_cliente_id IS NOT NULL THEN
      IF NEW.estado = 'verificado' THEN
        INSERT INTO notificaciones (cliente_id, titulo, mensaje, tipo)
        VALUES (
          v_cliente_id,
          '¡Tu pago fue aprobado!',
          'Confirmamos tu pago exitosamente. Tu historial de cuotas y puntos ha sido actualizado.',
          'pago_ok'
        );
      ELSE
        INSERT INTO notificaciones (cliente_id, titulo, mensaje, tipo)
        VALUES (
          v_cliente_id,
          'Pago rechazado',
          'No pudimos validar tu comprobante. Revisa la referencia y vuelve a reportarlo desde la pestaña Cuotas.',
          'pago_error'
        );
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_notificar_estado_pago ON pagos_reportados;
CREATE TRIGGER trg_notificar_estado_pago
AFTER UPDATE ON pagos_reportados
FOR EACH ROW EXECUTE FUNCTION fn_notificar_estado_pago();

-- 5. BYTECODE: PIN DINÁMICO DE 6 DÍGITOS (REEMPLAZA AL QR DE CASHEA)
CREATE TABLE IF NOT EXISTS bytecodes_compra (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_id UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    codigo VARCHAR(6) NOT NULL,
    usado BOOLEAN NOT NULL DEFAULT FALSE,
    expira_en TIMESTAMPTZ NOT NULL,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bytecodes_codigo ON bytecodes_compra(codigo);

ALTER TABLE bytecodes_compra ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Cliente crea y ve su ByteCode" ON bytecodes_compra;
CREATE POLICY "Cliente crea y ve su ByteCode"
ON bytecodes_compra FOR ALL
USING (auth.uid() = cliente_id)
WITH CHECK (auth.uid() = cliente_id);

DROP POLICY IF EXISTS "Tiendas y Admin validan ByteCode" ON bytecodes_compra;
CREATE POLICY "Tiendas y Admin validan ByteCode"
ON bytecodes_compra FOR SELECT
USING (true);

DROP POLICY IF EXISTS "Tiendas y Admin marcan ByteCode usado" ON bytecodes_compra;
CREATE POLICY "Tiendas y Admin marcan ByteCode usado"
ON bytecodes_compra FOR UPDATE
USING (true);

-- Función para que una Tienda Aliada envíe una orden en 1 Toque usando ByteCode o Cédula
CREATE OR REPLACE FUNCTION enviar_orden_tienda_bytecode(
    p_codigo VARCHAR,
    p_producto_id UUID,
    p_cantidad INT,
    p_tienda_nombre TEXT
) RETURNS JSON AS $$
DECLARE
    v_bc RECORD;
    v_cli RECORD;
    v_prod RECORD;
BEGIN
    SELECT * INTO v_bc
    FROM bytecodes_compra
    WHERE codigo = TRIM(p_codigo)
      AND usado = FALSE
      AND expira_en > NOW()
    ORDER BY creado_en DESC
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ByteCode inválido o expirado. Pide al cliente generar uno nuevo.';
    END IF;

    SELECT id, nombre, cedula, suspendido INTO v_cli FROM clientes WHERE id = v_bc.cliente_id;
    IF v_cli.suspendido THEN
        RAISE EXCEPTION 'Cliente bloqueado en el Buró Interno de Pagobyte.';
    END IF;

    SELECT nombre INTO v_prod FROM productos WHERE id = p_producto_id;

    -- Marcar ByteCode como usado
    UPDATE bytecodes_compra SET usado = TRUE WHERE id = v_bc.id;

    -- Crear solicitud automática desde tienda física
    INSERT INTO solicitudes (cliente_id, producto_id, cantidad, motivo, estado)
    VALUES (
        v_cli.id,
        p_producto_id,
        GREATEST(1, p_cantidad),
        'Compra en 1 Toque validada con ByteCode #' || v_bc.codigo || ' en tienda aliada: ' || p_tienda_nombre,
        'pendiente'
    );

    -- Disparar notificación instantánea al celular del cliente
    INSERT INTO notificaciones (cliente_id, titulo, mensaje, tipo)
    VALUES (
        v_cli.id,
        'Orden recibida en ' || p_tienda_nombre,
        'Validamos tu ByteCode para ' || COALESCE(v_prod.nombre, 'tu producto') || ' (x' || GREATEST(1, p_cantidad) || '). Tu solicitud está en revisión prioritaria.',
        'bytecode'
    );

    RETURN json_build_object('ok', true, 'cliente', v_cli.nombre, 'cedula', v_cli.cedula);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================================
-- ACTUALIZACIÓN v8: ALERTAS DE STOCK, CAJEROS DE TIENDA, GARANTÍAS/IMEI Y ACUERDOS
-- ============================================================================

-- 6. ALERTAS DE REPOSICIÓN DE STOCK (AVÍSAME CUANDO VUELVA)
CREATE TABLE IF NOT EXISTS alertas_stock (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_id UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    producto_id UUID NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
    notificado BOOLEAN NOT NULL DEFAULT FALSE,
    creada_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(cliente_id, producto_id)
);

ALTER TABLE alertas_stock ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Cliente registra alerta stock" ON alertas_stock;
CREATE POLICY "Cliente registra alerta stock"
ON alertas_stock FOR ALL
USING (auth.uid() = cliente_id)
WITH CHECK (auth.uid() = cliente_id);

DROP POLICY IF EXISTS "Admin gestiona alertas stock" ON alertas_stock;
CREATE POLICY "Admin gestiona alertas stock"
ON alertas_stock FOR ALL
USING (public.es_admin());

-- Trigger: Cuando un producto agotado vuelve a tener stock > 0, avisa a todos los suscritos
CREATE OR REPLACE FUNCTION fn_notificar_reposicion_stock()
RETURNS TRIGGER AS $$
BEGIN
  IF COALESCE(OLD.stock, 0) <= 0 AND NEW.stock > 0 THEN
    INSERT INTO notificaciones (cliente_id, titulo, mensaje, tipo)
    SELECT
      a.cliente_id,
      '¡Volvió el stock!',
      NEW.nombre || ' ya está disponible nuevamente en el catálogo de Pagobyte. ¡Solicítalo antes de que se agote!',
      'stock'
    FROM alertas_stock a
    WHERE a.producto_id = NEW.id AND a.notificado = FALSE;

    UPDATE alertas_stock
    SET notificado = TRUE
    WHERE producto_id = NEW.id AND notificado = FALSE;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_notificar_reposicion_stock ON productos;
CREATE TRIGGER trg_notificar_reposicion_stock
AFTER UPDATE OF stock ON productos
FOR EACH ROW EXECUTE FUNCTION fn_notificar_reposicion_stock();

-- 7. ROLES DE CAJERO PARA TIENDAS ALIADAS (DUEÑO vs CAJERO)
CREATE TABLE IF NOT EXISTS cajeros_tienda (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tienda_id UUID NOT NULL REFERENCES tiendas_aliadas(id) ON DELETE CASCADE,
    nombre VARCHAR(100) NOT NULL,
    pin_acceso VARCHAR(20) NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE cajeros_tienda ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Acceso cajeros tienda" ON cajeros_tienda;
CREATE POLICY "Acceso cajeros tienda"
ON cajeros_tienda FOR ALL
USING (true)
WITH CHECK (true);

-- 8. BITÁCORA DE GARANTÍAS Y SERIAL / IMEI EN COMPRAS
ALTER TABLE compras
  ADD COLUMN IF NOT EXISTS serial_imei VARCHAR(120) NULL,
  ADD COLUMN IF NOT EXISTS garantia_notas TEXT NULL;

-- 9. MÓDULO DE ACUERDOS DE PAGO PARA MOROSOS
CREATE TABLE IF NOT EXISTS acuerdos_pago (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    compra_id UUID NOT NULL REFERENCES compras(id) ON DELETE CASCADE,
    cliente_id UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    abono_hoy_usd NUMERIC(10,2) NOT NULL DEFAULT 0,
    nueva_fecha_limite DATE NOT NULL,
    congelar_mora BOOLEAN NOT NULL DEFAULT TRUE,
    condiciones TEXT NOT NULL,
    estado VARCHAR(25) NOT NULL DEFAULT 'vigente' CHECK (estado IN ('vigente', 'cumplido', 'incumplido')),
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE acuerdos_pago ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin gestiona acuerdos" ON acuerdos_pago;
CREATE POLICY "Admin gestiona acuerdos"
ON acuerdos_pago FOR ALL
USING (public.es_admin());

DROP POLICY IF EXISTS "Cliente ve sus acuerdos" ON acuerdos_pago;
CREATE POLICY "Cliente ve sus acuerdos"
ON acuerdos_pago FOR SELECT
USING (auth.uid() = cliente_id);


-- ============================================================================
-- ACTUALIZACIÓN DE SEGURIDAD v9 (BLINDAJE COMPLETO DE 20 PUNTOS)
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 10. HASHEO DE CONTRASEÑAS (BCRYPT) EN TIENDAS Y CAJEROS + TRIGGER AUTOMÁTICO
CREATE OR REPLACE FUNCTION fn_hash_clave_tienda()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.clave_acceso IS NOT NULL AND NEW.clave_acceso NOT LIKE '$2%' THEN
    NEW.clave_acceso := crypt(NEW.clave_acceso, gen_salt('bf'));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_hash_clave_tienda ON tiendas_aliadas;
CREATE TRIGGER trg_hash_clave_tienda
BEFORE INSERT OR UPDATE OF clave_acceso ON tiendas_aliadas
FOR EACH ROW EXECUTE FUNCTION fn_hash_clave_tienda();

CREATE OR REPLACE FUNCTION fn_hash_pin_cajero()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.pin_acceso IS NOT NULL AND NEW.pin_acceso NOT LIKE '$2%' THEN
    NEW.pin_acceso := crypt(NEW.pin_acceso, gen_salt('bf'));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_hash_pin_cajero ON cajeros_tienda;
CREATE TRIGGER trg_hash_pin_cajero
BEFORE INSERT OR UPDATE OF pin_acceso ON cajeros_tienda
FOR EACH ROW EXECUTE FUNCTION fn_hash_pin_cajero();

-- Hashear claves existentes que estuvieran en texto plano
UPDATE tiendas_aliadas SET clave_acceso = crypt(clave_acceso, gen_salt('bf')) WHERE clave_acceso NOT LIKE '$2%';
UPDATE cajeros_tienda SET pin_acceso = crypt(pin_acceso, gen_salt('bf')) WHERE pin_acceso NOT LIKE '$2%';

-- 4 y 7. RLS ESTRICTO: ELIMINAR ACCESO PÚBLICO DIRECTO A TIENDAS, CAJEROS Y BYTECODES
DROP POLICY IF EXISTS "Login tiendas aprobadas" ON tiendas_aliadas;
DROP POLICY IF EXISTS "Acceso cajeros tienda" ON cajeros_tienda;
DROP POLICY IF EXISTS "Admin gestiona cajeros" ON cajeros_tienda;
CREATE POLICY "Admin gestiona cajeros" ON cajeros_tienda FOR ALL USING (public.es_admin());

DROP POLICY IF EXISTS "Tiendas y Admin validan ByteCode" ON bytecodes_compra;
DROP POLICY IF EXISTS "Tiendas y Admin marcan ByteCode usado" ON bytecodes_compra;

-- 11. LIMITAR ACCESO LOGIN (RATE LIMITING EN BASE DE DATOS)
CREATE TABLE IF NOT EXISTS intentos_login_tienda (
    codigo_numerico VARCHAR(20) PRIMARY KEY,
    intentos INT NOT NULL DEFAULT 0,
    bloqueado_hasta TIMESTAMPTZ NULL,
    ultimo_intento TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE intentos_login_tienda ENABLE ROW LEVEL SECURITY;

-- 6, 10, 11, 13 y 17. RPC SEGURA DE LOGIN (BCRYPT + RATE LIMIT + RESPUESTA RECORTADA SIN CLAVES)
CREATE OR REPLACE FUNCTION login_tienda_o_cajero(
    p_codigo VARCHAR,
    p_clave TEXT
) RETURNS JSON AS $$
DECLARE
    v_cod TEXT := TRIM(p_codigo);
    v_int RECORD;
    v_tienda RECORD;
    v_cajero RECORD;
BEGIN
    -- Verificar bloqueo temporal por intentos fallidos (5 intentos = 5 min bloqueo)
    SELECT * INTO v_int FROM intentos_login_tienda WHERE codigo_numerico = v_cod;
    IF FOUND AND v_int.bloqueado_hasta IS NOT NULL AND v_int.bloqueado_hasta > NOW() THEN
        RAISE EXCEPTION 'Demasiados intentos fallidos. Espera 5 minutos antes de intentar de nuevo.';
    END IF;

    SELECT * INTO v_tienda FROM tiendas_aliadas WHERE codigo_numerico = v_cod LIMIT 1;
    IF NOT FOUND THEN
        INSERT INTO intentos_login_tienda (codigo_numerico, intentos, ultimo_intento)
        VALUES (v_cod, 1, NOW())
        ON CONFLICT (codigo_numerico) DO UPDATE
        SET intentos = intentos_login_tienda.intentos + 1,
            bloqueado_hasta = CASE WHEN intentos_login_tienda.intentos + 1 >= 5 THEN NOW() + INTERVAL '5 minutes' ELSE NULL END,
            ultimo_intento = NOW();
        RAISE EXCEPTION 'Código o contraseña incorrectos.';
    END IF;

    IF NOT v_tienda.activa THEN
        RAISE EXCEPTION 'Esta tienda se encuentra suspendida por Pagobyte.';
    END IF;

    -- Validar Dueño (bcrypt)
    IF v_tienda.clave_acceso = crypt(p_clave, v_tienda.clave_acceso) THEN
        DELETE FROM intentos_login_tienda WHERE codigo_numerico = v_cod;
        RETURN json_build_object(
            'rol', 'dueno',
            'operador', 'Dueño',
            'tienda', json_build_object(
                'id', v_tienda.id,
                'codigo_numerico', v_tienda.codigo_numerico,
                'nombre_comercial', v_tienda.nombre_comercial,
                'rif', v_tienda.rif,
                'banco_pago_movil', v_tienda.banco_pago_movil,
                'telefono_pago_movil', v_tienda.telefono_pago_movil
            )
        );
    END IF;

    -- Validar Cajero activo (bcrypt)
    SELECT * INTO v_cajero
    FROM cajeros_tienda
    WHERE tienda_id = v_tienda.id
      AND activo = TRUE
      AND pin_acceso = crypt(p_clave, pin_acceso)
    LIMIT 1;

    IF FOUND THEN
        DELETE FROM intentos_login_tienda WHERE codigo_numerico = v_cod;
        RETURN json_build_object(
            'rol', 'cajero',
            'operador', v_cajero.nombre,
            'tienda', json_build_object(
                'id', v_tienda.id,
                'codigo_numerico', v_tienda.codigo_numerico,
                'nombre_comercial', v_tienda.nombre_comercial
            )
        );
    END IF;

    -- Registrar intento fallido
    INSERT INTO intentos_login_tienda (codigo_numerico, intentos, ultimo_intento)
    VALUES (v_cod, 1, NOW())
    ON CONFLICT (codigo_numerico) DO UPDATE
    SET intentos = intentos_login_tienda.intentos + 1,
        bloqueado_hasta = CASE WHEN intentos_login_tienda.intentos + 1 >= 5 THEN NOW() + INTERVAL '5 minutes' ELSE NULL END,
        ultimo_intento = NOW();

    RAISE EXCEPTION 'Código o contraseña incorrectos.';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. ANTI-MANIPULACIÓN DE CAMPOS SENSIBLES EN CLIENTES
CREATE OR REPLACE FUNCTION fn_proteger_campos_cliente()
RETURNS TRIGGER AS $$
BEGIN
  IF current_user NOT IN ('postgres', 'supabase_admin')
     AND NOT public.es_admin()
     AND COALESCE(current_setting('app.bypass_cliente_guard', true), '') <> 'on' THEN
    NEW.fase := OLD.fase;
    NEW.puntos := OLD.puntos;
    NEW.kyc_verificado := OLD.kyc_verificado;
    NEW.suspendido := OLD.suspendido;
    NEW.motivo_suspension := OLD.motivo_suspension;
    NEW.cedula := OLD.cedula;
    NEW.nombre := OLD.nombre;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_proteger_campos_cliente ON clientes;
CREATE TRIGGER trg_proteger_campos_cliente
BEFORE UPDATE ON clientes
FOR EACH ROW EXECUTE FUNCTION fn_proteger_campos_cliente();

-- 16. RESTRINGIR SUBIDA DE ARCHIVOS EN STORAGE (MÁX 5 MB, SOLO IMÁGENES)
UPDATE storage.buckets
SET file_size_limit = 5242880,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
WHERE id IN ('kyc_documentos', 'comprobantes');


-- RPC pública segura para listar tiendas aliadas activas en la App (sin exponer claves ni correos)
CREATE OR REPLACE FUNCTION listar_tiendas_publicas()
RETURNS TABLE (
    id UUID,
    nombre_comercial VARCHAR,
    codigo_numerico VARCHAR
) AS $$
BEGIN
    RETURN QUERY
    SELECT t.id, t.nombre_comercial, t.codigo_numerico
    FROM tiendas_aliadas t
    WHERE t.activa = TRUE
    ORDER BY t.nombre_comercial ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- Catálogo por Tienda Aliada: vincular productos a su tienda correspondiente
ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS tienda_id UUID REFERENCES tiendas_aliadas(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_productos_tienda_id ON productos(tienda_id);


-- ============================================================================
-- ACTUALIZACIÓN v10: REFERIDOS, CONTROL DE VERSIÓN, FOTOS PRODUCTOS,
--                    VERIFICADOR PÚBLICO DE SOLVENCIA, ABONOS Y AUDITORÍA
-- ============================================================================

-- 17. CONFIGURACIÓN GLOBAL DE LA APP (Control de versión y parámetros públicos)
CREATE TABLE IF NOT EXISTS app_config (
    clave VARCHAR(60) PRIMARY KEY,
    valor TEXT NOT NULL,
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Lectura publica app_config" ON app_config;
CREATE POLICY "Lectura publica app_config" ON app_config FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admin edita app_config" ON app_config;
CREATE POLICY "Admin edita app_config" ON app_config FOR ALL USING (public.es_admin());

INSERT INTO app_config (clave, valor) VALUES
  ('version_minima', '1.0.0'),
  ('version_actual', '1.0.14'),
  ('url_descarga_apk', 'https://pagobyte.com/pagobyte.apk')
ON CONFLICT (clave) DO NOTHING;

-- 18. SISTEMA DE REFERIDOS ("Invita y sube de Fase")
ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS codigo_referido VARCHAR(16) UNIQUE NULL,
  ADD COLUMN IF NOT EXISTS referido_por UUID NULL REFERENCES clientes(id) ON DELETE SET NULL;

-- Generar código de referido único para clientes existentes sin código
UPDATE clientes
SET codigo_referido = 'PB-' || UPPER(SUBSTRING(REPLACE(id::text, '-', ''), 1, 6))
WHERE codigo_referido IS NULL;

CREATE OR REPLACE FUNCTION fn_generar_codigo_referido()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.codigo_referido IS NULL OR TRIM(NEW.codigo_referido) = '' THEN
    NEW.codigo_referido := 'PB-' || UPPER(SUBSTRING(REPLACE(NEW.id::text, '-', ''), 1, 6));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_generar_codigo_referido ON clientes;
CREATE TRIGGER trg_generar_codigo_referido
BEFORE INSERT ON clientes
FOR EACH ROW EXECUTE FUNCTION fn_generar_codigo_referido();

-- RPC segura para aplicar código de referido (1 sola vez por usuario)
CREATE OR REPLACE FUNCTION aplicar_codigo_referido(p_codigo VARCHAR)
RETURNS JSON AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_me RECORD;
  v_ref RECORD;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión.';
  END IF;

  SELECT * INTO v_me FROM clientes WHERE id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Perfil de cliente no encontrado.';
  END IF;

  IF v_me.referido_por IS NOT NULL THEN
    RAISE EXCEPTION 'Ya registraste un código de invitación anteriormente.';
  END IF;

  SELECT id, nombre INTO v_ref
  FROM clientes
  WHERE UPPER(codigo_referido) = UPPER(TRIM(p_codigo))
    AND id <> v_uid
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Código de invitación no válido.';
  END IF;

  PERFORM set_config('app.bypass_cliente_guard', 'on', true);
  UPDATE clientes SET referido_por = v_ref.id WHERE id = v_uid;
  -- Sumar +15 puntos de bienvenida al invitado y +25 puntos al anfitrión
  UPDATE clientes SET puntos = COALESCE(puntos, 0) + 15 WHERE id = v_uid;
  UPDATE clientes SET puntos = COALESCE(puntos, 0) + 25 WHERE id = v_ref.id;

  INSERT INTO notificaciones (cliente_id, titulo, mensaje, tipo)
  VALUES (
    v_ref.id,
    '¡Tu invitado se unió a Pagobyte!',
    v_me.nombre || ' usó tu código de invitación. Sumaste +25 puntos para subir de Fase.',
    'referido'
  );

  RETURN json_build_object('ok', true, 'anfitrion', v_ref.nombre, 'puntos_ganados', 15);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 19. FOTOS DE PRODUCTOS + BUCKET PÚBLICO LIMITADO (JPG/PNG/WEBP MÁX 2 MB)
ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS imagen_url TEXT NULL;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('productos_img', 'productos_img', true, 2097152, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE
SET public = true,
    file_size_limit = 2097152,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

DROP POLICY IF EXISTS "Lectura publica fotos productos" ON storage.objects;
CREATE POLICY "Lectura publica fotos productos"
ON storage.objects FOR SELECT
USING (bucket_id = 'productos_img');

DROP POLICY IF EXISTS "Subida fotos productos" ON storage.objects;
CREATE POLICY "Subida fotos productos"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'productos_img');

-- 20. VERIFICADOR PÚBLICO DE CERTIFICADO DE SOLVENCIA DIGITAL (SIN EXPONER DATOS PRIVADOS)
CREATE OR REPLACE FUNCTION verificar_solvencia_publica(p_codigo VARCHAR)
RETURNS JSON AS $$
DECLARE
  v_clean TEXT := UPPER(TRIM(p_codigo));
  v_hex TEXT;
  v_rec RECORD;
BEGIN
  v_hex := REPLACE(v_clean, 'PB-SOLV-', '');
  IF LENGTH(v_hex) < 6 THEN
    RETURN json_build_object('valida', false, 'mensaje', 'Formato de código inválido. Usa el formato PB-SOLV-XXXXXXXX.');
  END IF;

  SELECT
    c.id,
    c.total_usd,
    c.estado,
    c.creado_en,
    cl.nombre AS titular,
    cl.cedula AS cedula,
    p.nombre AS producto
  INTO v_rec
  FROM compras c
  JOIN clientes cl ON cl.id = c.cliente_id
  LEFT JOIN productos p ON p.id = c.producto_id
  WHERE UPPER(REPLACE(c.id::text, '-', '')) LIKE v_hex || '%'
    AND c.estado = 'pagada'
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN json_build_object('valida', false, 'mensaje', 'No existe una solvencia pagada al 100% con ese código.');
  END IF;

  RETURN json_build_object(
    'valida', true,
    'codigo', 'PB-SOLV-' || UPPER(SUBSTRING(REPLACE(v_rec.id::text, '-', ''), 1, 8)),
    'titular', v_rec.titular,
    'cedula_parcial', LEFT(v_rec.cedula, 4) || '****' || RIGHT(v_rec.cedula, 2),
    'producto', COALESCE(v_rec.producto, 'Compra Pagobyte'),
    'monto_saldado_usd', v_rec.total_usd,
    'estado', 'SOLVENTE (100% VERIFICADO)'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 21. ABONOS PARCIALES Y BITÁCORA DE AUDITORÍA
ALTER TABLE cuotas
  ADD COLUMN IF NOT EXISTS abonado_usd NUMERIC(10,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS auditoria_eventos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_tipo VARCHAR(30) NOT NULL,
    actor_nombre VARCHAR(120) NOT NULL,
    accion VARCHAR(120) NOT NULL,
    detalle TEXT NULL,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE auditoria_eventos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin ve auditoria" ON auditoria_eventos;
CREATE POLICY "Admin ve auditoria" ON auditoria_eventos FOR SELECT USING (public.es_admin());

DROP POLICY IF EXISTS "Insertar auditoria" ON auditoria_eventos;
CREATE POLICY "Insertar auditoria" ON auditoria_eventos FOR INSERT WITH CHECK (true);

-- Directorio público de tiendas aliadas (nombre, ciudad/rubro sin exponer RIF ni claves)
CREATE OR REPLACE FUNCTION listar_directorio_tiendas_web()
RETURNS TABLE (
    nombre_comercial VARCHAR,
    ciudad_direccion TEXT,
    categoria_productos VARCHAR
) AS $$
BEGIN
    RETURN QUERY
    SELECT
      t.nombre_comercial,
      COALESCE(s.ciudad_direccion, 'Venezuela') AS ciudad_direccion,
      COALESCE(s.categoria_productos, 'Comercio Aliado') AS categoria_productos
    FROM tiendas_aliadas t
    LEFT JOIN solicitudes_tiendas s ON s.id = t.solicitud_id
    WHERE t.activa = TRUE
    ORDER BY t.nombre_comercial ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
