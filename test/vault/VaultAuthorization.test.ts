import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { deploy } from '../../lib/helpers/deploy';
import { actionId } from '../../lib/helpers/actions';
import { MONTH } from '../../lib/helpers/time';
import { ZERO_ADDRESS } from '../../lib/helpers/constants';
import * as expectEvent from '../helpers/expectEvent';

describe('VaultAuthorization', function () {
  let authorizer: Contract, vault: Contract;
  let admin: SignerWithAddress, other: SignerWithAddress;
  let relayer: SignerWithAddress;

  const WHERE = ZERO_ADDRESS;

  before('setup signers', async () => {
    [, admin, other, relayer] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy authorizer', async () => {
    authorizer = await deploy('Authorizer', { args: [admin.address] });
  });

  async function deployVault(authorizer: string): Promise<Contract> {
    return deploy('Vault', { args: [authorizer, ZERO_ADDRESS, 0, 0] });
  }

  describe('authorizer', () => {
    it('has an initial authorizer', async () => {
      const vault = await deployVault(authorizer.address);

      expect(await vault.getAuthorizer()).to.equal(authorizer.address);
    });

    it('can be initialized to the zero address', async () => {
      const vault = await deployVault(ZERO_ADDRESS);

      expect(await vault.getAuthorizer()).to.equal(ZERO_ADDRESS);
    });
  });

  describe('change authorizer', () => {
    sharedBeforeEach('deploy vault', async () => {
      vault = await deployVault(authorizer.address);
    });

    context('when the sender is has the permission to do it', () => {
      let action: string;

      sharedBeforeEach('grant permission', async () => {
        action = await actionId(vault, 'changeAuthorizer');
        await authorizer.connect(admin).grantRole(action, admin.address);
      });

      it('can change the authorizer to another address', async () => {
        await vault.connect(admin).changeAuthorizer(other.address);

        expect(await vault.getAuthorizer()).to.equal(other.address);
      });

      it('emits an event when authorizer changed', async () => {
        const receipt = await (await vault.connect(admin).changeAuthorizer(other.address)).wait();
        expectEvent.inReceipt(receipt, 'AuthorizerChanged', {
          oldAuthorizer: authorizer.address,
          newAuthorizer: other.address,
        });
      });

      it('can change the authorizer to the zero address', async () => {
        await vault.connect(admin).changeAuthorizer(ZERO_ADDRESS);

        expect(await vault.getAuthorizer()).to.equal(ZERO_ADDRESS);
      });

      it('can not change the authorizer if the permission was revoked', async () => {
        await authorizer.connect(admin).revokeRole(action, admin.address);

        expect(await authorizer.canPerform(action, admin.address, WHERE)).to.be.false;

        await expect(vault.connect(admin).changeAuthorizer(other.address)).to.be.revertedWith('SENDER_NOT_ALLOWED');
      });
    });

    context('when the sender does not have the permission to do it', () => {
      it('reverts', async () => {
        await expect(vault.connect(other).changeAuthorizer(other.address)).to.be.revertedWith('SENDER_NOT_ALLOWED');
      });
    });
  });

  describe('change relayer allowance', () => {
    sharedBeforeEach('deploy vault', async () => {
      vault = await deployVault(authorizer.address);
    });

    context('when the sender is the user', () => {
      const itChangesTheRelayerAllowance = (approved: boolean) => {
        it('changes the allowance', async () => {
          await vault.connect(other).setRelayerApproval(other.address, relayer.address, approved);

          expect(await vault.hasApprovedRelayer(other.address, relayer.address)).to.eq(approved);
        });

        it('should emit an event when changing relayer allowance', async () => {
          const tx = await vault.connect(other).setRelayerApproval(other.address, relayer.address, approved);

          expectEvent.inReceipt(await tx.wait(), 'RelayerApprovalChanged', {
            relayer: relayer.address,
            sender: other.address,
            approved,
          });
        });
      };

      context('when the relayer was not allowed', () => {
        sharedBeforeEach('disallow relayer', async () => {
          await vault.connect(other).setRelayerApproval(other.address, relayer.address, false);
        });

        itChangesTheRelayerAllowance(true);
        itChangesTheRelayerAllowance(false);
      });

      context('when the relayer was allowed', () => {
        sharedBeforeEach('allow relayer', async () => {
          await vault.connect(other).setRelayerApproval(other.address, relayer.address, true);
        });

        itChangesTheRelayerAllowance(true);
        itChangesTheRelayerAllowance(false);
      });
    });

    context('when the sender is not the user', () => {
      it('reverts', async () => {
        await expect(
          vault.connect(relayer).setRelayerApproval(other.address, relayer.address, true)
        ).to.be.revertedWith('SENDER_NOT_ALLOWED');
      });
    });
  });

  describe('temporarily pausable', () => {
    const PAUSE_WINDOW_DURATION = MONTH * 3;
    const BUFFER_PERIOD_DURATION = MONTH;

    sharedBeforeEach(async () => {
      authorizer = await deploy('Authorizer', { args: [admin.address] });
      vault = await deploy('Vault', {
        args: [authorizer.address, ZERO_ADDRESS, PAUSE_WINDOW_DURATION, BUFFER_PERIOD_DURATION],
      });
    });

    context('when the sender has the permission to pause and unpause', () => {
      let action: string;

      sharedBeforeEach('grant permission', async () => {
        action = await actionId(vault, 'setPaused');
        await authorizer.connect(admin).grantRole(action, admin.address);
      });

      it('can pause', async () => {
        await vault.connect(admin).setPaused(true);

        const { paused } = await vault.getPausedState();
        expect(paused).to.be.true;
      });

      it('can unpause', async () => {
        await vault.connect(admin).setPaused(true);
        await vault.connect(admin).setPaused(false);

        const { paused } = await vault.getPausedState();
        expect(paused).to.be.false;
      });

      it('cannot pause if the permission is revoked', async () => {
        await authorizer.connect(admin).revokeRole(action, admin.address);
        expect(await authorizer.canPerform(action, admin.address, WHERE)).to.be.false;

        await expect(vault.connect(admin).setPaused(true)).to.be.revertedWith('SENDER_NOT_ALLOWED');
      });
    });

    context('when the sender does not have the permission to unpause', () => {
      it('reverts', async () => {
        await expect(vault.connect(other).setPaused(true)).to.be.revertedWith('SENDER_NOT_ALLOWED');
      });
    });
  });
});