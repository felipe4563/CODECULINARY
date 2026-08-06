const { Router } = require('express');
const ctrl = require('./ruleta.controller');
const auth = require('../../middlewares/auth');
const { verificarPermiso } = require('../../middlewares/permisos');

const router = Router();
router.use(auth);

router.get('/premios', verificarPermiso('ruleta', 'ver'), ctrl.listarPremios);
router.get('/premios/activos', verificarPermiso('ruleta', 'girar'), ctrl.listarPremiosActivos);
router.post('/premios', verificarPermiso('ruleta', 'crear'), ctrl.crearPremio);
router.put('/premios/:id', verificarPermiso('ruleta', 'editar'), ctrl.actualizarPremio);
router.delete('/premios/:id', verificarPermiso('ruleta', 'eliminar'), ctrl.eliminarPremio);

router.get('/estado', verificarPermiso('ruleta', 'girar'), ctrl.estado);
router.post('/girar', verificarPermiso('ruleta', 'girar'), ctrl.girar);

module.exports = router;
