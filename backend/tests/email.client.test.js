// Create stable mock objects
const mockSendMail = jest.fn().mockResolvedValue({});
const mockTransporter = { sendMail: mockSendMail };

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => mockTransporter),
}));

const nodemailer = require('nodemailer');
const { enviarCodigoPin } = require('../src/integrations/email/email.client');

describe('email.client', () => {
  beforeEach(() => {
    mockSendMail.mockClear();
    mockSendMail.mockResolvedValue({});
  });

  it('manda el código al destinatario con el remitente configurado', async () => {
    await enviarCodigoPin({ to: 'cliente@example.com', codigo: '123456' });

    expect(nodemailer.createTransport).toHaveBeenCalled();
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const llamada = mockSendMail.mock.calls[0][0];
    expect(llamada.to).toBe('cliente@example.com');
    expect(llamada.text).toContain('123456');
  });

  it('si sendMail falla, propaga un error con status 502', async () => {
    mockSendMail.mockRejectedValue(new Error('conexión rechazada'));

    await expect(enviarCodigoPin({ to: 'x@example.com', codigo: '000000' }))
      .rejects.toMatchObject({ status: 502 });
  });
});
