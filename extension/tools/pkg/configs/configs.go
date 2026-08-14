package configs

import (
	"crypto/ecdsa"
	"encoding/json"
	"os"

	"github.com/ethereum/go-ethereum/crypto"
)

const (
	ExtensionProxyURL = "http://localhost:6664"
	ChainNodeURL      = "http://127.0.0.1:8545"
)

const (
	AddressesFile            = "../docker/sim_dump/deployed-addresses.json"
	ExtensionProxyConfigFile = "./configs/proxy/extension_proxy.toml"
)

const (
	ExtConfigurationPort = 5501 // port on tee for setting the configurations (proxyURL, initialOwner, extensionID)
	ExtProxyInternalPort = 6663 // internal port for tee to get actions from the queue from the proxy
	ExtensionServerPort  = 7701 // port on the tee that the extension server calls for signing, encrypting, etc.
	ExtensionPort        = 7702 // the port on the extension server that the tee calls to send non system actions
)

var PrvWithFunds *ecdsa.PrivateKey

// init resolves the local-devnet fallback signer from LOCAL_DEVNET_PRIVATE_KEY.
// Deliberately no hardcoded key here — a repo should never ship a real
// private key, even one that "only" has local-devnet funds elsewhere. If
// unset, a fresh key is generated (won't have devnet funds; set the env var
// to a key you've funded yourself if you need this fallback to work).
func init() {
	var err error
	if key := os.Getenv("LOCAL_DEVNET_PRIVATE_KEY"); key != "" {
		PrvWithFunds, err = crypto.HexToECDSA(key)
		if err != nil {
			panic("cannot parse LOCAL_DEVNET_PRIVATE_KEY")
		}
		return
	}
	PrvWithFunds, err = crypto.GenerateKey()
	if err != nil {
		panic("cannot generate fallback devnet key")
	}
}

func ReadAddresses[T any](filePath string, dest *T) error {
	file, err := os.ReadFile(filePath)
	if err != nil {
		return err
	}

	err = json.Unmarshal(file, dest)

	return err
}
