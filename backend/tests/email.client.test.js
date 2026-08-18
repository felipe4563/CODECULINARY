jest.mock('nodemailer', () => ({
  createTransport: jest.fn(),
}));

const nodemailer = require('nodemailer');

describe('email.client', () => {
  let mockSendMail;

  beforeEach(() => {
    // Reset modules to clear the cached transporter in email.client
    jest.resetModules();

    mockSendMail = jest.fn().mockResolvedValue({});
    nodemailer.createTransport.mockReturnValue({
      sendMail: mockSendMail,
    });
  });

  const getEmailClient = () => {
    // Re-mock nodemailer after resetModules
    const nodemailerModule = require('nodemailer');
    nodemailerModule.createTransport = jest.fn().mockReturnValue({
      sendMail: mockSendMail,
    });
    return require('../src/integrations/email/email.client');
  };

  it('manda el código al destinatario con el remitente configurado', async () => {
    const { enviarCodigoPin } = getEmailClient();
    await enviarCodigoPin({ to: 'cliente@example.com', codigo: '123456' });

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const llamada = mockSendMail.mock.calls[0][0];
    expect(llamada.to).toBe('cliente@example.com');
    expect(llamada.text).toContain('123456');
  });

  it('si sendMail falla, propaga un error con status 502', async () => {
    mockSendMail.mockRejectedValue(new Error('conexión rechazada'));
    const { enviarCodigoPin } = getEmailClient();

    await expect(enviarCodigoPin({ to: 'x@example.com', codigo: '000000' }))
      .rejects.toMatchObject({ status: 502 });
  });
});
