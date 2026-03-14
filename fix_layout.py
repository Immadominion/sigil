with open('app/onboarding.tsx', 'r') as f: data = f.read()
import re
data = re.sub(r'          </Text>
        </View>
      </View>
    \);
  \}

  // ══════════════════════════════════════════════════════════════
  // RENDER — CONNECT', r'          </Text>
        </View>
      </View>
      </View>
    );
  }

  // ══════════════════════════════════════════════════════════════
  // RENDER — CONNECT', data)
with open('app/onboarding.tsx', 'w') as f: f.write(data)
import re
data = re.sub(r'          </Text>\n        </View>\n      </View>\n    \);
  }

  // ══════════════════════════════════════════════════════════════\n  // RENDER — CONNECT', r'          </Text>
        </View>
      </View>
      </View>
    );
  }

  // ══════════════════════════════════════════════════════════════
  // RENDER — CONNECT', data)
with open('app/onboarding.tsx', 'w') as f: f.write(data)
