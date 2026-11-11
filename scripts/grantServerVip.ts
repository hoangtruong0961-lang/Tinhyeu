import { adminRenewOrExtendMember, adminBuffTarget } from '../src/server/licenseService';

async function main() {
  const targets = ['MEM-9278-05EA', 'VT-9278-05EA'];
  
  for (const target of targets) {
    console.log(`\n========================================`);
    console.log(`Processing target: ${target}`);
    
    // 1. Grant/Extend in Member Store
    const resMember = adminRenewOrExtendMember({
      targetUidOrCode: target,
      action: 'extend_trial',
      customDays: 7,
      note: 'Cấp 7 ngày VIP bởi Admin'
    });
    console.log('Member Store Result:', resMember.message);

    // 2. Grant/Extend in License Store
    const resLicense = adminBuffTarget({
      target: target,
      plan: 'month',
      customDays: 7,
      note: 'Cấp 7 ngày VIP bởi Admin'
    });
    console.log('License Store Result:', resLicense.message);
  }
}

main().catch(console.error);
