import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from './AuthProvider';
import { ChangePasswordPage } from './ChangePasswordPage';
import { MockAuthClient } from './MockAuthClient';

describe('ChangePasswordPage', () => {
  it('requires matching passwords and accepts a valid new password', async () => {
    const user = userEvent.setup();
    render(
      <AuthProvider client={new MockAuthClient({ signedIn: true, delay: 0 })}>
        <MemoryRouter><ChangePasswordPage /></MemoryRouter>
      </AuthProvider>,
    );

    expect(screen.getByLabelText('Current password')).toBeTruthy();
    expect(screen.getByLabelText('New password')).toBeTruthy();
    expect(screen.getByLabelText('Repeat new password')).toBeTruthy();
    await user.type(screen.getByLabelText('Current password'), MockAuthClient.DEMO_PASSWORD);
    await user.type(screen.getByLabelText('New password'), 'a sufficiently long password');
    await user.type(screen.getByLabelText('Repeat new password'), 'a sufficiently long passwore');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('The new passwords do not match.')).toBeTruthy();

    await user.clear(screen.getByLabelText('Repeat new password'));
    await user.type(screen.getByLabelText('Repeat new password'), 'a sufficiently long password');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect((await screen.findByRole('status')).textContent).toContain('Password changed.');
  });
});
