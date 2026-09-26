-- backend/database/migrations/051_control_personal.sql
-- Control de personal: marcación de entrada/salida verificada por GPS +
-- horarios semanales + cierre automático de olvidos. Ver spec en
-- docs/superpowers/specs/2026-09-26-control-personal-design.md

ALTER TABLE sucursales
  ADD COLUMN radio_geocerca_metros INT UNSIGNED NOT NULL DEFAULT 150 AFTER longitud;

CREATE TABLE horarios_personal (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT UNSIGNED NOT NULL,
  dia_semana TINYINT UNSIGNED NOT NULL, -- 0=domingo ... 6=sábado
  trabaja TINYINT(1) NOT NULL DEFAULT 1, -- 0 = día libre
  hora_entrada TIME NULL,
  hora_salida TIME NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY horario_usuario_dia (usuario_id, dia_semana),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
);

CREATE TABLE marcaciones_personal (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT UNSIGNED NOT NULL,
  sucursal_id INT UNSIGNED NOT NULL,
  fecha DATE NOT NULL, -- día calendario del turno (hora Bolivia)

  hora_entrada DATETIME NOT NULL,
  lat_entrada DECIMAL(10,7) NULL,
  lng_entrada DECIMAL(10,7) NULL,
  verificacion_entrada ENUM('ok','fuera_de_rango','sin_verificar') NOT NULL DEFAULT 'sin_verificar',

  hora_salida DATETIME NULL,
  lat_salida DECIMAL(10,7) NULL,
  lng_salida DECIMAL(10,7) NULL,
  verificacion_salida ENUM('ok','fuera_de_rango','sin_verificar') NULL,

  estado ENUM('abierto','cerrado','cierre_automatico') NOT NULL DEFAULT 'abierto',

  hora_salida_propuesta DATETIME NULL,
  nota_propuesta VARCHAR(255) NULL,

  aprobado_por INT UNSIGNED NULL,
  aprobado_en DATETIME NULL,

  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
  FOREIGN KEY (sucursal_id) REFERENCES sucursales(id),
  FOREIGN KEY (aprobado_por) REFERENCES usuarios(id)
);

INSERT INTO permisos (modulo, accion, descripcion) VALUES
  ('personal', 'administrar', 'Configurar horarios, ver y aprobar registros de asistencia de todos los empleados');

INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT 1, p.id FROM permisos p
WHERE p.modulo = 'personal' AND p.accion = 'administrar';
